export interface IngestionFilePayload {
  filename: string;
  buffer: Buffer;
  mimeType: string;
}

export interface IngestionResult {
  documentId: string;
  version: string;
  chunksCreated: number;
  embeddingsGenerated: number;
  checksum: string;
  status: string;
}

export interface IKnowledgeIngestionService {
  processDocument(
    documentId: string,
    filePayload?: IngestionFilePayload,
  ): Promise<IngestionResult>;
}
