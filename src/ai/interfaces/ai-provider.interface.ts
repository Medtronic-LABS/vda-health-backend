export interface AiGenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  model?: string;
  correlationId?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AiGenerateResult {
  text: string;
  json?: Record<string, any>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
}

export interface AiClassifyOptions {
  candidateCategories: string[];
  systemPrompt?: string;
  correlationId?: string;
}

export interface AiClassifyResult {
  category: string;
  confidence: number;
  explanation?: string;
  provider: string;
}

export interface ProviderHealth {
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_CONFIGURED';
  details?: string;
}

export interface IAiProvider {
  generate(
    prompt: string,
    options?: AiGenerateOptions,
  ): Promise<AiGenerateResult>;

  classify(
    text: string,
    options?: AiClassifyOptions,
  ): Promise<AiClassifyResult>;

  healthCheck(): Promise<ProviderHealth>;
}
