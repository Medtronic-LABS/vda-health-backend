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

/** Exact service evidence only; broad words cannot become capability matches. */
export function iphsServiceTermPattern(term: string): string | null {
  const tokens = term.trim().toLowerCase().match(/[a-z0-9]+/g) || [];
  const generic = new Set(['test', 'scan', 'blood', 'service', 'diagnostic', 'imaging']);
  if (
    term.length > 80 ||
    !tokens.length ||
    tokens.length > 6 ||
    tokens.every((token) => generic.has(token)) ||
    (tokens.length === 1 && tokens[0].length < 3)
  ) {
    return null;
  }
  return `(^|[^a-z0-9])${tokens.join('[^a-z0-9]+')}($|[^a-z0-9])`;
}

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

  /** Bounded lexical supplement for the active, tenant-owned IPHS corpus. */
  async retrieveIphsServiceChunks(
    terms: string[],
    tenantId: string,
    state?: string,
    maxResults = 3,
  ): Promise<KnowledgeMatchChunk[]> {
    if (!tenantId) return [];
    if (!this.configService.knowledgeRagEnabled || !this.dataSource?.isInitialized) {
      throw new Error('IPHS_INDEX_UNAVAILABLE');
    }
    const patterns = Array.from(new Set(terms.map(iphsServiceTermPattern).filter(
      (pattern): pattern is string => Boolean(pattern),
    )));
    if (!patterns.length) return [];

    try {
      const embedding = await this.localEmbeddingProvider.generateEmbedding(terms.join(' '));
      const parameters: unknown[] = [tenantId, patterns, `[${embedding.join(',')}]`];
      const stateFilter = state
        ? `AND (c.state = $${parameters.push(state)} OR c.state IS NULL)`
        : '';
      parameters.push(Math.min(Math.max(maxResults, 1), 6));
      const rows: any[] = await this.dataSource.query(
        `SELECT c.id AS "chunkId", c."documentId", c."documentVersion",
                d.title, c.content, c.source, c.language, c.domain,
                c.category, c.metadata,
                (e.embedding <=> $3::vector) AS "cosineDistance"
         FROM knowledge_embeddings e
         JOIN knowledge_chunks c ON e."chunkId" = c.id
         JOIN knowledge_documents d ON c."documentId" = d.id
         WHERE d.status = 'ACTIVE'
           AND d."tenantId" = $1 AND c."tenantId" = $1
           AND d.domain = 'healthcare_facilities'
           AND c.domain = 'healthcare_facilities'
           AND d.category = 'iphs_2022_facility_standards'
           AND c.category = 'iphs_2022_facility_standards'
           AND d.title ILIKE 'IPHS 2022%'
           AND d.source ILIKE '%Indian Public Health Standards%'
           AND c.content ~* ANY($2::text[])
           ${stateFilter}
         ORDER BY "cosineDistance" ASC
         LIMIT $${parameters.length}`,
        parameters,
      );
      return rows.map((row) => {
        const distance = Number(row.cosineDistance);
        return {
          chunkId: row.chunkId,
          documentId: row.documentId,
          documentVersion: row.documentVersion,
          title: row.title,
          content: row.content,
          source: row.source,
          language: row.language,
          domain: row.domain,
          category: row.category,
          relevanceScore: Number(Math.max(0, Math.min(1, 1 - distance)).toFixed(4)),
          distance: Number(distance.toFixed(4)),
          metadata: row.metadata,
        };
      });
    } catch (error: unknown) {
      this.logger.warn(
        `IPHS lexical retrieval unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
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
        options?.maxResults ?? this.configService.knowledgeMaxResults;
      const minScore =
        options?.minRelevanceScore ??
        this.configService.knowledgeMinRelevanceScore;
      const maxContextLen =
        options?.maxContextLength ??
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
      addFilter('state', options?.state, options?.stateMatchMode !== 'EXACT');
      addFilter('district', options?.district, true);
      // Language is a preference, not an exclusion. The governed corpus can be
      // English while a patient asks in Hindi; an exact filter would hide all
      // authoritative knowledge and encourage an ungrounded response.
      let languagePreference = '0';
      if (options?.language) {
        parameters.push(options.language);
        languagePreference = `CASE WHEN c.language = $${parameters.length} THEN 0 ELSE 1 END`;
      }
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
          ${languagePreference} AS "languagePreference",
          (e.embedding <=> $1::vector) AS "cosineDistance"
        FROM knowledge_embeddings e
        JOIN knowledge_chunks c ON e."chunkId" = c.id
        JOIN knowledge_documents d ON c."documentId" = d.id
        WHERE ${predicates.join('\n          AND ')}
        ORDER BY "languagePreference" ASC, "cosineDistance" ASC
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
