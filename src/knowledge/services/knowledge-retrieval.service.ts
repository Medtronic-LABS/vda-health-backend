/* eslint-disable */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigurationService } from '../../configuration/configuration.service';
import { IKnowledgeRetrievalService } from '../interfaces/knowledge-retrieval.interface';
import { DevelopmentKnowledgeService } from './development-knowledge.service';
import { LocalSemanticEmbeddingProvider } from '../providers/local/local-semantic-embedding.provider';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../observability/metrics.service';
import {
  KnowledgeRetrievalOptions,
  KnowledgeRetrievalResult,
  KnowledgeMatchChunk,
  KnowledgeSourceCitation,
} from '../models/knowledge-retrieval.model';

@Injectable()
export class KnowledgeRetrievalService implements IKnowledgeRetrievalService {
  private readonly logger = new Logger(KnowledgeRetrievalService.name);

  constructor(
    private readonly configService: ConfigurationService,
    private readonly devKnowledgeService: DevelopmentKnowledgeService,
    private readonly localEmbeddingProvider: LocalSemanticEmbeddingProvider,
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  async healthCheck(): Promise<boolean> {
    if (!this.configService.knowledgeRagEnabled) {
      return this.devKnowledgeService.healthCheck();
    }
    try {
      if (this.dataSource && this.dataSource.isInitialized) {
        await this.dataSource.query(`SELECT 1;`);
        return true;
      }
    } catch {
      return false;
    }
    return true;
  }

  async retrieve(
    query = '',
    options?: KnowledgeRetrievalOptions,
  ): Promise<KnowledgeRetrievalResult> {
    const startTime = Date.now();
    const isRagEnabled = this.configService.knowledgeRagEnabled;

    if (!isRagEnabled || !this.dataSource || !this.dataSource.isInitialized) {
      this.logger.log(
        `[RAG] Using DevelopmentKnowledgeService (KNOWLEDGE_RAG_ENABLED=${isRagEnabled})`,
      );
      return this.devKnowledgeService.retrieve(query, options);
    }

    try {
      if (this.auditService) {
        await this.auditService.logEvent({
          tenantId: '00000000-0000-0000-0000-000000000000',
          subjectAbhaRef: 'anonymous',
          actingPrincipal: 'system',
          correlationId: 'rag-query-action',
          action: 'knowledge_retrieval_started',
          entityName: 'knowledge_index',
          entityId: 'rag-query',
          details: {
            intent: options?.intent || 'UNKNOWN',
            domain: options?.domain || 'ALL',
            language: options?.language || 'hi',
          },
        });
      }

      // 1. Generate dense 384-dim semantic embedding for query
      const queryEmbedding =
        await this.localEmbeddingProvider.generateEmbedding(query);
      const vectorStr = `[${queryEmbedding.join(',')}]`;

      const maxResults =
        options?.maxResults || this.configService.knowledgeMaxResults;
      const minScore =
        options?.minRelevanceScore ||
        this.configService.knowledgeMinRelevanceScore;
      const maxContextLen =
        options?.maxContextLength ||
        this.configService.knowledgeMaxContextLength;

      // 2. Query PostgreSQL pgvector cosine similarity search (<=> operator)
      const rawQuery = `
        SELECT 
          c.id AS "chunkId",
          c."documentId",
          c."documentVersion",
          d.title AS "title",
          c.content AS "content",
          c.source AS "source",
          c.language AS "language",
          c.domain AS "domain",
          c.category AS "category",
          c.metadata AS "metadata",
          (e.embedding <=> $1::vector) AS "cosineDistance"
        FROM knowledge_embeddings e
        JOIN knowledge_chunks c ON e."chunkId" = c.id
        JOIN knowledge_documents d ON c."documentId" = d.id
        WHERE d.status IN ('ACTIVE', 'PUBLISHED', 'APPROVED')
          ${options?.domain ? `AND c.domain = '${options.domain}'` : ''}
          ${options?.language ? `AND c.language = '${options.language}'` : ''}
          ${options?.state ? `AND (c.state = '${options.state}' OR c.state IS NULL)` : ''}
          ${options?.district ? `AND (c.district = '${options.district}' OR c.district IS NULL)` : ''}
        ORDER BY "cosineDistance" ASC
        LIMIT $2;
      `;

      const rows: any[] = await this.dataSource.query(rawQuery, [
        vectorStr,
        maxResults * 2,
      ]);

      const matchedChunks: KnowledgeMatchChunk[] = [];
      let totalLen = 0;

      for (const r of rows) {
        // Distance normalization: Cosine distance in [0, 2], score = 1 - distance
        const distance = Number(r.cosineDistance || 0);
        const score = Math.max(0, Math.min(1, 1 - distance));

        if (score >= minScore) {
          if (totalLen + r.content.length <= maxContextLen) {
            matchedChunks.push({
              chunkId: r.chunkId,
              documentId: r.documentId,
              documentVersion: r.documentVersion,
              title: r.title,
              content: r.content,
              source: r.source,
              language: r.language,
              domain: r.domain,
              category: r.category,
              relevanceScore: Number(score.toFixed(4)),
              distance: Number(distance.toFixed(4)),
              metadata: r.metadata,
            });
            totalLen += r.content.length;
          }
        }
        if (matchedChunks.length >= maxResults) break;
      }

      // If no pgvector matches met threshold, fall back to DevelopmentKnowledgeService
      if (matchedChunks.length === 0) {
        this.logger.warn(
          `[RAG] No pgvector chunks met minRelevanceScore (${minScore}). Falling back to synthetic fixtures.`,
        );
        return this.devKnowledgeService.retrieve(query, options);
      }

      const sources: KnowledgeSourceCitation[] = Array.from(
        new Set(matchedChunks.map((c) => c.documentId)),
      ).map((docId) => {
        const chunk = matchedChunks.find((c) => c.documentId === docId)!;
        return {
          title: chunk.title,
          source: chunk.source,
          version: chunk.documentVersion,
          domain: chunk.domain,
        };
      });

      const formattedKnowledgePrompt = matchedChunks
        .map(
          (c) =>
            `[KNOWLEDGE SOURCE]\nTitle: ${c.title}\nSource: ${c.source} (v${c.documentVersion})\nDomain: ${c.domain}\nContent:\n${c.content}\n[/KNOWLEDGE SOURCE]`,
        )
        .join('\n\n');

      const latencyMs = Date.now() - startTime;

      if (this.auditService) {
        await this.auditService.logEvent({
          tenantId: '00000000-0000-0000-0000-000000000000',
          subjectAbhaRef: 'anonymous',
          actingPrincipal: 'system',
          correlationId: 'rag-query-action',
          action: 'knowledge_retrieval_completed',
          entityName: 'knowledge_index',
          entityId: 'rag-query',
          details: {
            intent: options?.intent || 'UNKNOWN',
            chunks_retrieved: matchedChunks.length,
            latency_ms: latencyMs,
            provider_type: 'postgres_pgvector',
          },
        });
      }

      if (this.metricsService) {
        try {
          this.metricsService.recordKnowledgeRequest({
            intentCategory: options?.intent || 'UNKNOWN',
            providerType: 'postgres_pgvector',
            status: 'SUCCESS',
            durationMs: latencyMs,
          });
        } catch {
          // Fail-safe
        }
      }

      return {
        matchedChunks,
        sources,
        formattedKnowledgePrompt,
        retrievedCount: matchedChunks.length,
        intent: options?.intent || 'GENERAL_HEALTH_QUERY',
        providerType: 'postgres_pgvector',
        latencyMs,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[RAG] pgvector retrieval error (${errMsg}). Falling back to Dev service.`,
      );
      return this.devKnowledgeService.retrieve(query, options);
    }
  }
}
