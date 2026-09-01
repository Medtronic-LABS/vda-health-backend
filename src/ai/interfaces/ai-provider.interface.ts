export interface AiGenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  /** Optional native provider schema for a JSON response; never used to synthesize content locally. */
  jsonSchema?: Record<string, unknown>;
  model?: string;
  correlationId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Additive Gemini-compatible inline document/image parts. Text-only calls are unchanged. */
  inlineData?: Array<{ mimeType: string; data: Buffer | string }>;
  /** Safe diagnostic label for development telemetry; never includes patient data. */
  telemetryLabel?: string;
  /** Optional provider-supported reasoning level for constrained response formatting. */
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
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
  /** Privacy-sanitized, consent-scoped prior turns for contextual classification. */
  conversationContext?: string;
}

export interface AiClassifyResult {
  category: string;
  confidence: number;
  explanation?: string;
  /** Semantic constraints are source hints, never patient-facing facts. */
  requirements?: {
    state?: string;
    district?: string;
    facilityType?: 'PUBLIC' | 'PRIVATE';
    scheme?: string;
    service?: string;
    /** A bounded, semantic plan. Values are validated before any record access. */
    recordCategories?: string[];
    knowledgeRequired?: boolean;
    responseRequirements?: string[];
  };
  /** The language inferred from the current turn and its retained conversation. */
  language?: 'hi' | 'en';
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
