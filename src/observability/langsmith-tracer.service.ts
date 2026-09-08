import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'langsmith';
import { RunTree } from 'langsmith/run_trees';
import { ConfigurationService } from '../configuration/configuration.service';
import {
  StepTraceOptions,
  StepTraceResult,
  StepUsage,
  TurnTraceSummary,
} from './telemetry.interface';

export interface TurnTraceContext {
  id: string;
  sessionId: string;
  correlationId: string;
  inputText: string;
  language?: string;
  tenantId?: string;
  externalId?: string;
  startTime: number;
  rootRun?: RunTree;
  steps: StepTraceResult[];
}

@Injectable()
export class LangSmithTracerService implements OnModuleInit {
  private readonly logger = new Logger(LangSmithTracerService.name);
  private client: Client | null = null;
  private readonly isTracingConfigured: boolean;
  private readonly projectName: string;
  private readonly recentSummaries: TurnTraceSummary[] = [];
  private readonly MAX_RECENT_SUMMARIES = 100;

  constructor(private readonly config: ConfigurationService) {
    this.isTracingConfigured = this.config.langsmithEnabled;
    this.projectName = this.config.langsmithProject;
  }

  onModuleInit() {
    if (this.isTracingConfigured && this.config.langsmithApiKey) {
      try {
        this.client = new Client({
          apiKey: this.config.langsmithApiKey,
          apiUrl: this.config.langsmithEndpoint,
        });
        this.logger.log(
          `[LangSmithTracer] Initialized LangSmith client for project "${this.projectName}" at ${this.config.langsmithEndpoint}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[LangSmithTracer] Could not initialize LangSmith client: ${msg}. Running in local telemetry mode.`,
        );
      }
    } else {
      this.logger.log(
        `[LangSmithTracer] Running in local telemetry mode (LANGCHAIN_API_KEY not set). Cost, latency, and call necessity are tracked in-memory.`,
      );
    }
  }

  /**
   * Starts a new root trace for a conversation turn.
   */
  async startTurn(options: {
    sessionId: string;
    correlationId: string;
    inputText: string;
    language?: string;
    tenantId?: string;
    externalId?: string;
  }): Promise<TurnTraceContext> {
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const startTime = Date.now();

    let rootRun: RunTree | undefined;

    if (this.client) {
      try {
        rootRun = new RunTree({
          name: 'vda_conversation_turn',
          run_type: 'chain',
          inputs: {
            turnId,
            sessionId: options.sessionId,
            correlationId: options.correlationId,
            inputText: options.inputText,
            language: options.language || 'unspecified',
          },
          client: this.client,
          project_name: this.projectName,
          tags: [
            'vda-turn',
            `lang:${options.language || 'detect'}`,
            `tenant:${options.tenantId || 'unknown'}`,
          ],
          extra: {
            metadata: {
              sessionId: options.sessionId,
              correlationId: options.correlationId,
              tenantId: options.tenantId,
              actingPrincipal: options.externalId,
            },
          },
        });

        await rootRun.postRun();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[LangSmithTracer] Failed to post root run: ${msg}`);
      }
    }

    return {
      id: turnId,
      sessionId: options.sessionId,
      correlationId: options.correlationId,
      inputText: options.inputText,
      language: options.language,
      tenantId: options.tenantId,
      externalId: options.externalId,
      startTime,
      rootRun,
      steps: [],
    };
  }

  /**
   * Executes a step within a turn, measuring latency, token usage, cost, and call necessity.
   */
  async traceStep<T>(
    context: TurnTraceContext,
    options: StepTraceOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const stepStart = Date.now();
    let childRun: RunTree | undefined;

    if (context.rootRun) {
      try {
        childRun = await context.rootRun.createChild({
          name: options.name,
          run_type: options.runType,
          inputs: options.inputs || {},
          tags: [
            options.name,
            options.provider || 'unknown',
            `necessity:${options.necessity || 'NECESSARY'}`,
            ...(options.tags || []),
          ],
          extra: {
            metadata: {
              provider: options.provider,
              model: options.model,
              necessity: options.necessity || 'NECESSARY',
              necessityReason: options.necessityReason,
              isRetry: options.isRetry || false,
              correlationId: context.correlationId,
              ...(options.metadata || {}),
            },
          },
        });

        await childRun.postRun();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[LangSmithTracer] Failed to post child run "${options.name}": ${msg}`);
      }
    }

    let error: Error | undefined;
    let result: T | undefined;

    try {
      result = await fn();
      return result;
    } catch (err: unknown) {
      error = err instanceof Error ? err : new Error(String(err));
      throw error;
    } finally {
      const stepDuration = Date.now() - stepStart;
      const resolvedProvider = this.resultString(result, 'provider') || options.provider || 'rule-engine';
      const resolvedModel = this.resultString(result, 'model') || options.model || 'default';
      const usage = this.extractUsageFromResult(result);
      const accounting = this.calculateAccounting(
        resolvedProvider,
        resolvedModel,
        usage,
        true,
      );

      const necessity = options.necessity || 'NECESSARY';
      const necessityReason =
        options.necessityReason ||
        (necessity === 'NECESSARY'
          ? 'Required for primary flow'
          : 'Optional or redundant invocation');

      const stepRecord: StepTraceResult = {
        stepName: options.name,
        runType: options.runType,
        provider: resolvedProvider,
        model: resolvedModel,
        latencyMs: stepDuration,
        costUsd: accounting.costUsd,
        usage,
        usageStatus: accounting.usageStatus,
        costStatus: accounting.costStatus,
        executed: true,
        necessity,
        necessityReason,
        isRetry: options.isRetry || false,
        error: error ? error.message : undefined,
      };

      context.steps.push(stepRecord);

      if (childRun) {
        try {
          await childRun.end({
            outputs: this.sanitizeOutputForTrace(result),
            error: error ? error.message : undefined,
          });

          // LangSmith extra usage metadata patch
          if (childRun.extra) {
            childRun.extra.metadata = {
              ...(childRun.extra.metadata || {}),
              provider: resolvedProvider,
              model: resolvedModel,
              ...this.safeResultMetadata(result),
              cost_usd: accounting.costUsd,
              latency_ms: stepDuration,
              usage: usage || {},
              usage_status: accounting.usageStatus,
              cost_status: accounting.costStatus,
              executed: true,
            };
          }

          await childRun.patchRun();
        } catch (patchErr: unknown) {
          const pMsg = patchErr instanceof Error ? patchErr.message : String(patchErr);
          this.logger.warn(`[LangSmithTracer] Failed to patch child run "${options.name}": ${pMsg}`);
        }
      }
    }
  }

  /**
   * Directly records a completed or skipped/bypassed step (e.g. when deterministically handled).
   */
  recordStepDirectly(
    context: TurnTraceContext,
    options: StepTraceOptions,
    result: {
      latencyMs: number;
      usage?: StepUsage;
      output?: any;
      error?: string;
      executed?: boolean;
    },
  ): void {
    const executed = result.executed ?? true;
    const accounting = this.calculateAccounting(
      options.provider || 'rule-engine',
      options.model || 'default',
      result.usage,
      executed,
    );

    const stepRecord: StepTraceResult = {
      stepName: options.name,
      runType: options.runType,
      provider: options.provider || 'rule-engine',
      model: options.model || 'default',
      latencyMs: result.latencyMs,
      costUsd: accounting.costUsd,
      usage: result.usage,
      usageStatus: accounting.usageStatus,
      costStatus: accounting.costStatus,
      executed,
      necessity: options.necessity || 'NECESSARY',
      necessityReason: options.necessityReason || 'Directly recorded execution',
      isRetry: options.isRetry || false,
      error: result.error,
    };

    context.steps.push(stepRecord);
  }

  /**
   * Finalizes the turn trace, aggregates all step metrics, computes efficiency,
   * generates cost-reduction recommendations, and persists the trace summary.
   */
  async endTurn(
    context: TurnTraceContext,
    turnResult: {
      responseType: string;
      content?: Record<string, any>;
      intent: string;
      selectedAgent: string;
      safetyStatus: string;
    },
  ): Promise<TurnTraceSummary> {
    const totalLatencyMs = Date.now() - context.startTime;

    let totalCostUsd = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalProviderReportedTokens = 0;
    let totalThinkingTokens = 0;
    let totalCachedContentTokens = 0;
    let totalToolUsePromptTokens = 0;
    let necessaryCalls = 0;
    let unnecessaryCalls = 0;
    let preventableRetries = 0;

    for (const step of context.steps) {
      totalCostUsd += step.costUsd;
      if (step.usage) {
        totalPromptTokens += step.usage.promptTokens || 0;
        totalCompletionTokens += step.usage.completionTokens || 0;
        totalProviderReportedTokens +=
          step.usage.providerReportedTotalTokens ||
          step.usage.totalTokens ||
          0;
        totalThinkingTokens += step.usage.thoughtsTokens || 0;
        totalCachedContentTokens += step.usage.cachedContentTokens || 0;
        totalToolUsePromptTokens += step.usage.toolUsePromptTokens || 0;
      }
      if (step.executed && step.necessity === 'NECESSARY') {
        necessaryCalls++;
      } else if (
        step.executed &&
        (step.necessity === 'UNNECESSARY' || step.necessity === 'REDUNDANT')
      ) {
        unnecessaryCalls++;
      }
      if (
        step.executed &&
        (step.isRetry || step.necessity === 'PREVENTABLE_RETRY')
      ) {
        preventableRetries++;
      }
    }

    const totalCalls = context.steps.filter((step) => step.executed).length;
    const efficiencyScorePercent =
      totalCalls > 0
        ? Math.round(((necessaryCalls) / totalCalls) * 100)
        : 100;

    const optimizationRecommendations = this.generateOptimizationAdvice(
      context,
      turnResult,
    );

    const summary: TurnTraceSummary = {
      turnId: context.id,
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      timestamp: new Date().toISOString(),
      inputExcerpt: context.inputText.slice(0, 100),
      intent: turnResult.intent,
      selectedAgent: turnResult.selectedAgent,
      safetyStatus: turnResult.safetyStatus,
      totalLatencyMs,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalPromptTokens,
      totalCompletionTokens,
      totalProviderReportedTokens,
      totalThinkingTokens,
      totalCachedContentTokens,
      totalToolUsePromptTokens,
      totalCalls,
      necessaryCalls,
      unnecessaryCalls,
      preventableRetries,
      efficiencyScorePercent,
      steps: context.steps,
      optimizationRecommendations,
      langsmithUrl: context.rootRun?.id
        ? `https://smith.langchain.com/o/${this.projectName}/runs/${context.rootRun.id}`
        : undefined,
    };

    // Store in ring buffer
    this.recentSummaries.unshift(summary);
    if (this.recentSummaries.length > this.MAX_RECENT_SUMMARIES) {
      this.recentSummaries.pop();
    }

    if (context.rootRun) {
      try {
        await context.rootRun.end({
          outputs: {
            responseType: turnResult.responseType,
            intent: turnResult.intent,
            selectedAgent: turnResult.selectedAgent,
            safetyStatus: turnResult.safetyStatus,
            summary: turnResult.content?.summary,
          },
        });

        if (context.rootRun.extra) {
          context.rootRun.extra.metadata = {
            ...(context.rootRun.extra.metadata || {}),
            total_latency_ms: totalLatencyMs,
            total_cost_usd: summary.totalCostUsd,
            total_prompt_tokens: totalPromptTokens,
            total_completion_tokens: totalCompletionTokens,
            total_provider_reported_tokens: totalProviderReportedTokens,
            total_thinking_tokens: totalThinkingTokens,
            total_cached_content_tokens: totalCachedContentTokens,
            total_tool_use_prompt_tokens: totalToolUsePromptTokens,
            efficiency_score_pct: efficiencyScorePercent,
            total_api_calls: totalCalls,
            unnecessary_calls: unnecessaryCalls,
            preventable_retries: preventableRetries,
            optimizations: optimizationRecommendations,
          };
        }

        await context.rootRun.patchRun();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[LangSmithTracer] Failed to close root run: ${msg}`);
      }
    }

    this.logger.log(
      `[LangSmithTelemetry] turn=${context.id} session=${context.sessionId} intent=${turnResult.intent} latency=${totalLatencyMs}ms cost=$${summary.totalCostUsd.toFixed(6)} visible_tokens=${totalPromptTokens + totalCompletionTokens} provider_total_tokens=${totalProviderReportedTokens} thinking_tokens=${totalThinkingTokens} calls=${totalCalls} (necessary=${necessaryCalls}, unnecessary=${unnecessaryCalls}, retries=${preventableRetries}) efficiency=${efficiencyScorePercent}%`,
    );

    return summary;
  }

  /**
   * Returns recent turn summaries from the in-memory telemetry buffer.
   */
  getRecentTraces(limit = 20): TurnTraceSummary[] {
    return this.recentSummaries.slice(0, Math.min(limit, this.MAX_RECENT_SUMMARIES));
  }

  /**
   * Aggregates cost and latency metrics across recent turns.
   */
  getCostSummary(): {
    totalTurns: number;
    totalCostUsd: number;
    totalTokens: number;
    avgLatencyMs: number;
    unnecessaryCallsRate: number;
    optimizationTips: string[];
  } {
    if (this.recentSummaries.length === 0) {
      return {
        totalTurns: 0,
        totalCostUsd: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
        unnecessaryCallsRate: 0,
        optimizationTips: ['No conversation turns recorded yet.'],
      };
    }

    let sumCost = 0;
    let sumTokens = 0;
    let sumLatency = 0;
    let totalCalls = 0;
    let unnecessaryCalls = 0;
    const tipsSet = new Set<string>();

    for (const summary of this.recentSummaries) {
      sumCost += summary.totalCostUsd;
      sumTokens += summary.totalPromptTokens + summary.totalCompletionTokens;
      sumLatency += summary.totalLatencyMs;
      totalCalls += summary.totalCalls;
      unnecessaryCalls += summary.unnecessaryCalls + summary.preventableRetries;
      for (const tip of summary.optimizationRecommendations) {
        tipsSet.add(tip);
      }
    }

    return {
      totalTurns: this.recentSummaries.length,
      totalCostUsd: Number(sumCost.toFixed(6)),
      totalTokens: sumTokens,
      avgLatencyMs: Math.round(sumLatency / this.recentSummaries.length),
      unnecessaryCallsRate:
        totalCalls > 0
          ? Number(((unnecessaryCalls / totalCalls) * 100).toFixed(1))
          : 0,
      optimizationTips: Array.from(tipsSet).slice(0, 5),
    };
  }

  /**
   * Calculates the cost of an invocation based on provider, model, and token counts.
   */
  calculateCost(provider: string, model: string, usage?: StepUsage): number {
    if (!usage && provider !== 'sarvam') return 0;

    // Gemini 1.5 / 2.5 / 3.5 Flash pricing
    // Input: $0.075 / 1M tokens ($0.000000075 / token)
    // Output/thinking: $0.30 / 1M tokens ($0.0000003 / token)
    if (provider === 'gemini' && /flash/i.test(model)) {
      const promptCost = (usage?.promptTokens || 0) * 0.000000075;
      const completionCost =
        ((usage?.completionTokens || 0) + (usage?.thoughtsTokens || 0)) *
        0.0000003;
      return promptCost + completionCost;
    }

    // Gemini Pro pricing
    // Input: $1.25 / 1M tokens ($0.00000125 / token)
    // Output/thinking: $5.00 / 1M tokens ($0.000005 / token)
    if (provider === 'gemini' && /pro/i.test(model)) {
      const promptCost = (usage?.promptTokens || 0) * 0.00000125;
      const completionCost =
        ((usage?.completionTokens || 0) + (usage?.thoughtsTokens || 0)) *
        0.000005;
      return promptCost + completionCost;
    }

    // Sarvam API calls: flat ~$0.001 per language detection or translation invocation
    if (provider === 'sarvam') {
      return 0.001;
    }

    // Xenova local embeddings: $0.00 (in-process quantized inference)
    if (provider === 'xenova') {
      return 0;
    }

    // Generic token estimation if tokens are present
    if (usage?.totalTokens) {
      return usage.totalTokens * 0.0000001;
    }

    return 0;
  }

  private calculateAccounting(
    provider: string,
    model: string,
    usage: StepUsage | undefined,
    executed: boolean,
  ): {
    costUsd: number;
    usageStatus: StepTraceResult['usageStatus'];
    costStatus: StepTraceResult['costStatus'];
  } {
    if (!executed) {
      return {
        costUsd: 0,
        usageStatus: 'NOT_APPLICABLE',
        costStatus: 'NOT_APPLICABLE',
      };
    }

    if (provider === 'gemini') {
      if (!usage) {
        return {
          costUsd: 0,
          usageStatus: 'UNAVAILABLE',
          costStatus: 'UNAVAILABLE',
        };
      }
      return {
        costUsd: this.calculateCost(provider, model, usage),
        usageStatus: 'REPORTED',
        costStatus: 'ACTUAL',
      };
    }

    if (provider === 'sarvam') {
      return {
        costUsd: this.calculateCost(provider, model, usage),
        usageStatus: 'NOT_APPLICABLE',
        costStatus: 'ESTIMATED',
      };
    }

    return {
      costUsd: this.calculateCost(provider, model, usage),
      usageStatus: usage ? 'REPORTED' : 'NOT_APPLICABLE',
      costStatus: 'NOT_APPLICABLE',
    };
  }

  private extractUsageFromResult(result: any): StepUsage | undefined {
    if (!result || typeof result !== 'object') return undefined;
    if (result.usage && typeof result.usage === 'object') {
      return {
        promptTokens: Number(result.usage.promptTokens || result.usage.promptTokenCount || 0),
        completionTokens: Number(
          result.usage.completionTokens || result.usage.candidatesTokenCount || 0,
        ),
        totalTokens: Number(result.usage.totalTokens || result.usage.totalTokenCount || 0),
        providerReportedTotalTokens: Number(
          result.usage.providerReportedTotalTokens ||
            result.usage.totalTokenCount ||
            result.usage.totalTokens ||
            0,
        ),
        ...(Number.isFinite(result.usage.thoughtsTokens) ||
        Number.isFinite(result.usage.thoughtsTokenCount)
          ? {
              thoughtsTokens: Number(
                result.usage.thoughtsTokens ||
                  result.usage.thoughtsTokenCount ||
                  0,
              ),
            }
          : {}),
        ...(Number.isFinite(result.usage.cachedContentTokens) ||
        Number.isFinite(result.usage.cachedContentTokenCount)
          ? {
              cachedContentTokens: Number(
                result.usage.cachedContentTokens ||
                  result.usage.cachedContentTokenCount ||
                  0,
              ),
            }
          : {}),
        ...(Number.isFinite(result.usage.toolUsePromptTokens) ||
        Number.isFinite(result.usage.toolUsePromptTokenCount)
          ? {
              toolUsePromptTokens: Number(
                result.usage.toolUsePromptTokens ||
                  result.usage.toolUsePromptTokenCount ||
                  0,
              ),
            }
          : {}),
      };
    }
    return undefined;
  }

  private sanitizeOutputForTrace(result: any): Record<string, any> {
    if (!result) return { status: 'empty' };
    if (typeof result === 'string') return { textExcerpt: result.slice(0, 200) };
    if (typeof result === 'object') {
      const copy = { ...result };
      // Redact any possible sensitive patient credentials
      delete copy.password;
      delete copy.token;
      delete copy.apiKey;
      delete copy.audioBuffer;
      delete copy.audio;
      delete copy.transcript;
      return copy;
    }
    return { value: String(result) };
  }

  /** Only provider-operation metadata that is safe to send to telemetry. */
  private safeResultMetadata(result: unknown): Record<string, unknown> {
    if (!result || typeof result !== 'object') return {};
    const value = result as Record<string, unknown>;
    const allowed = [
      'primaryProvider',
      'fallbackUsed',
      'fallbackReason',
      'detectedLanguage',
      'audioDurationMs',
      'successCategory',
    ];
    return Object.fromEntries(
      allowed
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]]),
    );
  }

  private resultString(result: unknown, key: string): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const value = (result as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private generateOptimizationAdvice(
    context: TurnTraceContext,
    turnResult: { intent: string; safetyStatus: string },
  ): string[] {
    const advice: string[] = [];

    const hasRedundantLangDetect = context.steps.some(
      (s) => s.stepName === 'language_detection' && s.necessity === 'REDUNDANT',
    );
    if (hasRedundantLangDetect) {
      advice.push(
        'Client already supplied language: redundant Sarvam language detection call detected. Bypass to save ~150ms and $0.001 per turn.',
      );
    }

    const hasRetries = context.steps.some((s) => s.isRetry);
    if (hasRetries) {
      advice.push(
        'Response generation required a retry due to invalid JSON schema. Enforcing stricter model schema constraints can eliminate duplicate token costs.',
      );
    }

    if (turnResult.safetyStatus === 'ESCALATED_BY_RULE') {
      advice.push(
        'Turn was safely escalated by deterministic SafetyGate, avoiding downstream LLM and knowledge retrieval costs.',
      );
    }

    const llmCalls = context.steps.filter((s) => s.runType === 'llm');
    if (llmCalls.length > 1 && !hasRetries) {
      advice.push(
        'Multiple LLM calls were made in this turn (e.g. classification + generation). Consider fused classification-generation or few-shot routing caching to reduce latency.',
      );
    }

    return advice;
  }
}
