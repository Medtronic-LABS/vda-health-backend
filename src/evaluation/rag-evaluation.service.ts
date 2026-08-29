import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RagEvaluationTrace } from '../database/entities/rag-evaluation-trace.entity';
import { KnowledgeRetrievalResult } from '../knowledge/models/knowledge-retrieval.model';
import { KnowledgeRetrievalService } from '../knowledge/services/knowledge-retrieval.service';
import { ConfigurationService } from '../configuration/configuration.service';

interface ControlledCase {
  query: string;
  language: string;
  expectedIntent: string;
  expectedDomain: string;
  expectedMinChunks: number;
  isEscalation: boolean;
  expectedSourceKeywords: string[];
}

@Injectable()
export class RagEvaluationService {
  constructor(@InjectRepository(RagEvaluationTrace) private readonly traces: Repository<RagEvaluationTrace>, private readonly retrieval: KnowledgeRetrievalService, @InjectDataSource() private readonly dataSource: DataSource, private readonly config: ConfigurationService) {}

  readonly controlledCases: ControlledCase[] = [
    { query: 'HbA1c meaning', language: 'hi', expectedIntent: 'LAB_RESULT_QUERY', expectedDomain: 'laboratory', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['hba1c', 'lab', 'diabetes'] },
    { query: 'HbA1c explanation', language: 'hi', expectedIntent: 'LAB_RESULT_QUERY', expectedDomain: 'laboratory', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['hba1c', 'lab'] },
    { query: 'medication query', language: 'hi', expectedIntent: 'MEDICATION_QUERY', expectedDomain: 'medication', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['medication', 'drug'] },
    { query: 'medication timing', language: 'hi', expectedIntent: 'MEDICATION_QUERY', expectedDomain: 'medication', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['medication', 'timing'] },
    { query: 'prescription explanation', language: 'hi', expectedIntent: 'PRESCRIPTION_QUERY', expectedDomain: 'medication', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['prescription', 'medication'] },
    { query: 'PM-JAY benefits', language: 'hi', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['pm-jay', 'ayushman', 'pmjay'] },
    { query: 'PM-JAY eligibility', language: 'hi', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['pm-jay', 'ayushman', 'pmjay'] },
    { query: 'HIMCARE benefits', language: 'hi', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['himcare', 'himachal'] },
    { query: 'HIMCARE eligibility', language: 'hi', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['himcare', 'himachal'] },
    { query: 'HIMCARE required documents', language: 'hi', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['himcare', 'document'] },
    { query: 'Haryana scheme', language: 'hi', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['haryana'] },
    { query: 'Haryana facility', language: 'en', expectedIntent: 'FACILITY_QUERY', expectedDomain: 'healthcare_facilities', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['haryana', 'hospital', 'facility'] },
    { query: 'Himachal facility', language: 'en', expectedIntent: 'FACILITY_QUERY', expectedDomain: 'healthcare_facilities', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['himachal', 'hospital', 'facility'] },
    { query: 'Delhi facility', language: 'en', expectedIntent: 'FACILITY_QUERY', expectedDomain: 'healthcare_facilities', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['delhi', 'hospital', 'facility'] },
    { query: 'general health', language: 'hi', expectedIntent: 'GENERAL_HEALTH_QUERY', expectedDomain: 'preventive_health', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['health', 'preventive'] },
    { query: 'Hindi PM-JAY', language: 'hi', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['pm-jay', 'ayushman', 'pmjay'] },
    { query: 'Hinglish HIMCARE', language: 'hi-Latn', expectedIntent: 'GOVERNMENT_SCHEME_QUERY', expectedDomain: 'government_schemes', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: ['himcare'] },
    { query: 'source attribution', language: 'en', expectedIntent: 'GENERAL_HEALTH_QUERY', expectedDomain: 'preventive_health', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['health'] },
    { query: 'referral', language: 'hi', expectedIntent: 'REFERRAL_QUERY', expectedDomain: 'referral_protocols', expectedMinChunks: 1, isEscalation: false, expectedSourceKeywords: ['referral'] },
    { query: 'teleconsultation', language: 'hi', expectedIntent: 'TELECONSULTATION_QUERY', expectedDomain: 'telemedicine', expectedMinChunks: 0, isEscalation: false, expectedSourceKeywords: [] },
  ];

  private scoreTrace(caseSpec: ControlledCase, result: KnowledgeRetrievalResult): { contextPrecision: number | null; contextRecall: number | null; faithfulness: number | null; answerRelevancy: number | null } {
    const chunks = result.matchedChunks || [];
    const sources = result.sources || [];
    const minRelevance = this.config.knowledgeMinRelevanceScore;

    // Context Precision: relevant chunks / total chunks
    let contextPrecision: number | null = null;
    if (chunks.length > 0) {
      const relevantChunks = chunks.filter(c => Number(c.relevanceScore) >= minRelevance).length;
      contextPrecision = relevantChunks / chunks.length;
    } else if (caseSpec.expectedMinChunks === 0) {
      // No retrieval expected and none returned — precision is valid at 1.0
      contextPrecision = 1.0;
    }

    // Context Recall: did we get at least the minimum expected chunks?
    let contextRecall: number | null = null;
    if (caseSpec.expectedMinChunks > 0) {
      const relevantCount = chunks.filter(c => Number(c.relevanceScore) >= minRelevance).length;
      contextRecall = relevantCount >= caseSpec.expectedMinChunks ? 1.0 : 0.0;
    } else {
      // No retrieval expected — recall is 1.0
      contextRecall = 1.0;
    }

    // Faithfulness: do retrieved sources match expected domain?
    let faithfulness: number | null = null;
    if (sources.length > 0 && caseSpec.expectedSourceKeywords.length > 0) {
      const sourceTexts = sources.map(s => [s.title, s.source, s.domain].filter(Boolean).join(' ').toLowerCase());
      const matchingKeywords = caseSpec.expectedSourceKeywords.filter(kw =>
        sourceTexts.some(text => text.includes(kw.toLowerCase())),
      );
      faithfulness = matchingKeywords.length / caseSpec.expectedSourceKeywords.length;
    } else if (caseSpec.expectedSourceKeywords.length === 0) {
      // No source expectations — mark as full faithfulness
      faithfulness = 1.0;
    }

    // Answer Relevancy: placeholder for per-trace (calculated as aggregate across batch)
    const answerRelevancy: number | null = null;

    return { contextPrecision, contextRecall, faithfulness, answerRelevancy };
  }

  async runControlled(tenantId: string) {
    const traces: RagEvaluationTrace[] = [];
    const scores: Array<{ contextPrecision: number | null; contextRecall: number | null; faithfulness: number | null }> = [];

    for (const caseSpec of this.controlledCases) {
      const result = await this.retrieval.retrieve(caseSpec.query, { tenantId, language: caseSpec.language, intent: caseSpec.expectedIntent, domain: caseSpec.expectedDomain, maxResults: 5 });
      const caseScores = this.scoreTrace(caseSpec, result);
      scores.push(caseScores);

      const trace = await this.recordRetrieval({
        tenantId, query: caseSpec.query, normalizedQuery: caseSpec.query,
        intent: caseSpec.expectedIntent, language: caseSpec.language, domain: caseSpec.expectedDomain,
        result,
        contextPrecision: caseScores.contextPrecision,
        contextRecall: caseScores.contextRecall,
        faithfulness: caseScores.faithfulness,
        answerRelevancy: caseScores.answerRelevancy,
      });
      traces.push(trace);
    }

    // Aggregate metrics
    const avg = (values: (number | null)[]) => {
      const valid = values.filter((v): v is number => v !== null);
      return valid.length > 0 ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(4)) : null;
    };

    const escalationCases = this.controlledCases.filter(c => c.isEscalation);
    const escalationRecall = escalationCases.length > 0 ? null : null; // No escalation cases in current dataset

    return {
      executed: traces.length,
      successful: traces.filter(t => t.retrievedChunkCount > 0 || this.controlledCases.find(c => c.query === t.query)?.expectedMinChunks === 0).length,
      failed: traces.filter(t => t.retrievedChunkCount === 0 && (this.controlledCases.find(c => c.query === t.query)?.expectedMinChunks ?? 0) > 0).length,
      evaluation: {
        contextPrecision: avg(scores.map(s => s.contextPrecision)),
        contextRecall: avg(scores.map(s => s.contextRecall)),
        faithfulness: avg(scores.map(s => s.faithfulness)),
        answerRelevancy: null as number | null, // Requires LLM judge — not available in development evaluator
        escalationRecall,
        method: 'DEVELOPMENT_DETERMINISTIC',
        description: 'Deterministic evaluation against the controlled development dataset. These metrics are not official RAGAS judge scores.',
      },
      traceIds: traces.map(t => t.id),
    };
  }

  async recordRetrieval(input: {
    tenantId: string; query: string; normalizedQuery?: string; intent?: string; agent?: string;
    language?: string; domain?: string; state?: string; response?: string; result: KnowledgeRetrievalResult;
    contextPrecision?: number | null; contextRecall?: number | null; faithfulness?: number | null; answerRelevancy?: number | null;
  }): Promise<RagEvaluationTrace> {
    const { result } = input;
    return this.traces.save(this.traces.create({
      tenantId: input.tenantId, query: input.query.slice(0, 1000), normalizedQuery: input.normalizedQuery?.slice(0, 1000) || null,
      intent: input.intent || null, agent: input.agent || null, language: input.language || null, domain: input.domain || null, state: input.state || null,
      providerType: result.providerType, retrievedChunkCount: result.retrievedCount, retrievalLatencyMs: result.latencyMs,
      sources: result.sources.map((source) => ({ title: source.title, source: source.source, version: source.version, domain: source.domain })),
      chunks: result.matchedChunks.map((chunk) => ({ chunkId: chunk.chunkId, documentId: chunk.documentId, relevanceScore: chunk.relevanceScore, distance: chunk.distance })),
      response: input.response?.slice(0, 1000) || null,
      contextPrecision: input.contextPrecision ?? null,
      contextRecall: input.contextRecall ?? null,
      faithfulness: input.faithfulness ?? null,
      answerRelevancy: input.answerRelevancy ?? null,
    }));
  }

  async dashboard(tenantId: string) {
    const traces = await this.traces.find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: 100 });
    const breakdown = (field: 'agent' | 'intent' | 'language' | 'domain' | 'state') => Object.entries(traces.reduce<Record<string, number>>((result, trace) => {
      const key = trace[field] || 'Not available'; result[key] = (result[key] || 0) + 1; return result;
    }, {})).map(([key, count]) => ({ key, count }));
    const total = traces.length;
    const ratio = (count: number) => total ? Number((count / total).toFixed(4)) : null;
    const chunksFor = (trace: RagEvaluationTrace) => Array.isArray(trace.chunks) ? trace.chunks : [];
    const sourcesFor = (trace: RagEvaluationTrace) => Array.isArray(trace.sources) ? trace.sources : [];
    const successful = traces.filter((trace) => trace.retrievedChunkCount > 0);
    const relevant = traces.filter((trace) => chunksFor(trace).some((chunk) => Number(chunk['relevanceScore']) >= this.config.knowledgeMinRelevanceScore));
    const cited = traces.filter((trace) => sourcesFor(trace).length > 0);
    const stateConstrained = traces.filter((trace) => Boolean(trace.state));
    const failedCases = traces.filter((trace) => trace.retrievedChunkCount === 0).map((trace) => ({ id: trace.id, query: trace.query, intent: trace.intent, domain: trace.domain, reason: 'NO_RETRIEVED_CHUNKS' }));

    // Aggregate evaluation scores from scored traces
    const scoredTraces = traces.filter(t => t.contextPrecision !== null || t.contextRecall !== null || t.faithfulness !== null);
    const avg = (values: (number | null | undefined)[]) => {
      const valid = values.filter((v): v is number => v !== null && v !== undefined);
      return valid.length > 0 ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(4)) : null;
    };
    const lastEvalTrace = scoredTraces.length > 0 ? scoredTraces[0] : null;

    return {
      evaluationCount: total,
      evaluation: {
        totalCases: this.controlledCases.length,
        executedCases: scoredTraces.length,
        successfulCases: scoredTraces.filter(t => t.retrievedChunkCount > 0 || t.contextRecall === 1.0).length,
        failedCases: scoredTraces.filter(t => t.retrievedChunkCount === 0 && t.contextRecall !== 1.0).length,
        lastRunAt: lastEvalTrace?.createdAt || null,
        contextPrecision: avg(scoredTraces.map(t => t.contextPrecision)),
        contextRecall: avg(scoredTraces.map(t => t.contextRecall)),
        faithfulness: avg(scoredTraces.map(t => t.faithfulness)),
        answerRelevancy: avg(scoredTraces.map(t => t.answerRelevancy)),
        escalationRecall: null as number | null,
        method: 'DEVELOPMENT_DETERMINISTIC',
        description: 'Deterministic evaluation against the controlled development dataset. These metrics are not official RAGAS judge scores.',
      },
      operational: {
        totalEvaluationCases: total,
        averageRetrievalLatencyMs: total ? Number((traces.reduce((sum, trace) => sum + trace.retrievalLatencyMs, 0) / total).toFixed(2)) : null,
        averageRetrievedChunks: total ? Number((traces.reduce((sum, trace) => sum + trace.retrievedChunkCount, 0) / total).toFixed(2)) : null,
        successfulRetrievalRate: ratio(successful.length),
        relevantRetrievalRate: ratio(relevant.length),
        citationCoverageRate: ratio(cited.length),
        stateIsolationRate: null,
        stateIsolationStatus: stateConstrained.length ? 'N/A — source-state provenance is unavailable in existing traces' : 'N/A — no state-constrained traces recorded',
        stateConstrainedCaseCount: stateConstrained.length,
        failedCaseCount: failedCases.length,
        failedCases,
      },
      breakdowns: { agent: breakdown('agent'), intent: breakdown('intent'), language: breakdown('language'), domain: breakdown('domain'), state: breakdown('state') },
      traces: traces.slice(0, 20).map((trace) => ({ id: trace.id, query: trace.query, normalizedQuery: trace.normalizedQuery, intent: trace.intent, agent: trace.agent, retrievedChunkCount: trace.retrievedChunkCount, retrievalLatencyMs: trace.retrievalLatencyMs, sources: trace.sources, chunks: trace.chunks, createdAt: trace.createdAt })),
    };
  }

  async adminSummary(tenantId: string) {
    const count = async (table: string, where = '"tenantId" = $1', params: unknown[] = [tenantId]) => {
      const rows = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`, params);
      return Number(rows[0]?.count || 0);
    };
    const [syntheticPatients, activeMedications, prescriptions, adherenceEvents, facilities, knowledgeDocuments, activeKnowledgeDocuments, activeSessions, ragQueries, safetyEscalations, embeddingRows] = await Promise.all([
      count('synthetic_patients'),
      count('medications', '"tenantId" = $1 AND "verificationStatus" = $2 AND status = $3', [tenantId, 'CONFIRMED', 'ACTIVE']),
      count('prescriptions'),
      count('medication_adherence_events'),
      count('facilities'),
      count('knowledge_documents'),
      count('knowledge_documents', '"tenantId" = $1 AND status = $2', [tenantId, 'ACTIVE']),
      count('sessions', '"tenantId" = $1 AND status = $2 AND "absoluteExpiresAt" > NOW()', [tenantId, 'ACTIVE']),
      count('rag_evaluation_traces'),
      count('audit_events', '"tenantId" = $1 AND action = $2', [tenantId, 'safety_escalated']),
      this.dataSource.query('SELECT COUNT(*)::int AS count FROM knowledge_embeddings e INNER JOIN knowledge_chunks c ON c.id = e."chunkId" WHERE c."tenantId" = $1', [tenantId]),
    ]);
    const embeddings = Number(embeddingRows[0]?.count || 0);
    return { syntheticPatients, activeMedications, prescriptions, adherenceEvents, facilities, knowledgeDocuments, activeKnowledgeDocuments, embeddings, activeSessions, ragQueries, safetyEscalations };
  }
}
