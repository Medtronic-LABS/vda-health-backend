export type CallNecessity =
  | 'NECESSARY'
  | 'UNNECESSARY'
  | 'REDUNDANT'
  | 'PREVENTABLE_RETRY'
  | 'BYPASSED_SAFE';

export interface StepUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface StepTraceOptions {
  name: string;
  runType: 'llm' | 'tool' | 'retriever' | 'chain' | 'prompt';
  provider?: 'gemini' | 'sarvam' | 'xenova' | 'abdm' | 'safety-gate' | 'rule-engine';
  model?: string;
  inputs?: Record<string, any>;
  necessity?: CallNecessity;
  necessityReason?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  isRetry?: boolean;
}

export interface StepTraceResult {
  stepName: string;
  runType: string;
  provider: string;
  model: string;
  latencyMs: number;
  costUsd: number;
  usage?: StepUsage;
  necessity: CallNecessity;
  necessityReason: string;
  isRetry: boolean;
  error?: string;
}

export interface TurnTraceSummary {
  turnId: string;
  sessionId: string;
  correlationId: string;
  timestamp: string;
  inputExcerpt: string;
  intent?: string;
  selectedAgent?: string;
  safetyStatus?: string;
  totalLatencyMs: number;
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCalls: number;
  necessaryCalls: number;
  unnecessaryCalls: number;
  preventableRetries: number;
  efficiencyScorePercent: number;
  steps: StepTraceResult[];
  optimizationRecommendations: string[];
  langsmithUrl?: string;
}
