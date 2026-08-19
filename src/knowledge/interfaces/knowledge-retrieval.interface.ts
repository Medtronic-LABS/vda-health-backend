import {
  KnowledgeRetrievalOptions,
  KnowledgeRetrievalResult,
} from '../models/knowledge-retrieval.model';

export interface IKnowledgeRetrievalService {
  /**
   * Performs semantic vector similarity search or fallback retrieval.
   */
  retrieve(
    query: string,
    options?: KnowledgeRetrievalOptions,
  ): Promise<KnowledgeRetrievalResult>;

  /**
   * Health check for retrieval engine.
   */
  healthCheck(): Promise<boolean>;
}
