export interface KnowledgeChunkModel {
  chunkId: string;
  documentId: string;
  documentVersion: string;
  content: string;
  chunkIndex: number;
  language: string;
  domain: string;
  category: string;
  role: string | null;
  state: string | null;
  district: string | null;
  source: string;
  embeddingRef?: string | null;
  metadata: Record<string, any> | null;
  createdAt: Date;
}
