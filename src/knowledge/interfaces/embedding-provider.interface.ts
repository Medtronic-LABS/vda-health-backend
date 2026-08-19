export interface ModelInfo {
  name: string;
  dimension: number;
  provider: string;
}

export interface IEmbeddingProvider {
  /**
   * Generates a dense 384-dimensional vector embedding for a single text.
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generates dense 384-dimensional vector embeddings for a batch of texts.
   */
  generateEmbeddings(texts: string[]): Promise<number[][]>;

  /**
   * Verifies health and availability of embedding provider.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Returns metadata about model name, dimension, and provider.
   */
  getModelInfo(): ModelInfo;
}
