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

    if (!isRagEnabled) {
      this.logger.log(
        `[RAG] Using DevelopmentKnowledgeService (KNOWLEDGE_RAG_ENABLED=${isRagEnabled})`,
      );
      return this.devKnowledgeService.retrieve(query, options);
    }

    if (!this.dataSource || !this.dataSource.isInitialized) {
      this.logger.error('[RAG] PostgreSQL is unavailable while KNOWLEDGE_RAG_ENABLED=true');
      return this.emptyResult(options, 'postgres_pgvector_unavailable', startTime);
    }
    if (!options?.tenantId) {
      this.logger.error('[RAG] Authenticated tenant is required for enabled RAG retrieval');
      return this.emptyResult(options, 'postgres_pgvector_tenant_required', startTime);
    }

    try {
      if (this.auditService) {
        await this.auditService.logEvent({
          tenantId: options.tenantId,
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
      const predicates = ["d.status IN ('ACTIVE', 'PUBLISHED')"];
      const parameters: unknown[] = [vectorStr];
      parameters.push(options.tenantId);
      predicates.push(`c."tenantId" = $${parameters.length}`);
      const addFilter = (column: string, value?: string, allowGlobal = false) => {
        if (!value) return;
        parameters.push(value);
        const position = `$${parameters.length}`;
        predicates.push(
          allowGlobal
            ? `(c.${column} = ${position} OR c.${column} IS NULL)`
            : `c.${column} = ${position}`,
        );
      };
      addFilter('domain', options?.domain);
      addFilter('category', options?.category);
      addFilter('role', options?.role, true);
      addFilter('language', options?.language);
      addFilter('state', options?.state, true);
      addFilter('district', options?.district, true);
      parameters.push(maxResults * 2);

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
        WHERE ${predicates.join('\n          AND ')}
        ORDER BY "cosineDistance" ASC
        LIMIT $${parameters.length};
      `;

      const rows: any[] = await this.dataSource.query(rawQuery, parameters);

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

      // An enabled RAG environment must never substitute synthetic knowledge for
      // an absent/low-relevance result. The caller can safely answer that no
      // approved general knowledge matched the question.
      if (matchedChunks.length === 0) {
        return this.emptyResult(options, 'postgres_pgvector', startTime);
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
          tenantId: options.tenantId,
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
      this.logger.error(`[RAG] pgvector retrieval error: ${errMsg}`);
      return this.emptyResult(options, 'postgres_pgvector_error', startTime);
    }
  }

  private emptyResult(
    options: KnowledgeRetrievalOptions | undefined,
    providerType: string,
    startTime: number,
  ): KnowledgeRetrievalResult {
    return {
      matchedChunks: [],
      sources: [],
      formattedKnowledgePrompt: '',
      retrievedCount: 0,
      intent: options?.intent || 'GENERAL_HEALTH_QUERY',
      providerType,
      latencyMs: Date.now() - startTime,
    };
  }
}
