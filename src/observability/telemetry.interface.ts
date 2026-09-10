export type CallNecessity =
  | 'NECESSARY'
  | 'UNNECESSARY'
  | 'REDUNDANT'
  | 'PREVENTABLE_RETRY'
  | 'BYPASSED_SAFE';

export interface StepUsage {
  promptTokens?: number;
  completionTokens?: number;
  /**
   * Legacy alias of Gemini usageMetadata.totalTokenCount. This can include
   * internal thinking tokens and must not be read as prompt + completion.
   */
  totalTokens?: number;
  /** Canonical provider total, preserved exactly from usageMetadata. */
  providerReportedTotalTokens?: number;
  thoughtsTokens?: number;
  cachedContentTokens?: number;
  toolUsePromptTokens?: number;
}

export type UsageStatus = 'REPORTED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
export type CostStatus = 'ACTUAL' | 'ESTIMATED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';

export interface StepTraceOptions {
  name: string;
  runType: 'llm' | 'tool' | 'retriever' | 'chain' | 'prompt';
  provider?: 'gemini' | 'sarvam' | 'sravaani' | 'dhvaani' | 'xenova' | 'abdm' | 'safety-gate' | 'rule-engine';
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
  usageStatus: UsageStatus;
  costStatus: CostStatus;
  /** False for a deliberately skipped stage; skipped stages are not calls. */
  executed: boolean;
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
  /** Sum of Gemini/API totalTokenCount values, not prompt + visible completion. */
  totalProviderReportedTokens: number;
  totalThinkingTokens: number;
  totalCachedContentTokens: number;
  totalToolUsePromptTokens: number;
  totalCalls: number;
  necessaryCalls: number;
  unnecessaryCalls: number;
  preventableRetries: number;
  efficiencyScorePercent: number;
  steps: StepTraceResult[];
  optimizationRecommendations: string[];
  langsmithUrl?: string;
}
