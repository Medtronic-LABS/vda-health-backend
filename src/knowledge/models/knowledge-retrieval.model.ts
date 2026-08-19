export interface KnowledgeRetrievalOptions {
  query?: string;
  intent?: string;
  language?: string;
  domain?: string;
  category?: string;
  role?: string;
  state?: string;
  district?: string;
  maxResults?: number;
  minRelevanceScore?: number;
  maxContextLength?: number;
}

export interface KnowledgeMatchChunk {
  chunkId: string;
  documentId: string;
  documentVersion: string;
  title: string;
  content: string;
  source: string;
  language: string;
  domain: string;
  category: string;
  relevanceScore: number;
  distance?: number;
  metadata?: Record<string, any> | null;
}

export interface KnowledgeSourceCitation {
  title: string;
  source: string;
  version: string;
  domain?: string;
}

export interface KnowledgeRetrievalResult {
  matchedChunks: KnowledgeMatchChunk[];
  sources: KnowledgeSourceCitation[];
  formattedKnowledgePrompt: string;
  retrievedCount: number;
  intent: string;
  providerType: string;
  latencyMs: number;
}
