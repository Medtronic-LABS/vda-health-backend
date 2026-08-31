import { Injectable, Logger } from '@nestjs/common';
import { ConfigurationService } from '../../../configuration/configuration.service';
import {
  IAiProvider,
  AiGenerateOptions,
  AiGenerateResult,
  AiClassifyOptions,
  AiClassifyResult,
  ProviderHealth,
} from '../../interfaces/ai-provider.interface';

@Injectable()
export class GeminiProvider implements IAiProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly unavailableUntil = new Map<number, number>();

  constructor(private readonly config: ConfigurationService) {}

  async generate(
    prompt: string,
    options?: AiGenerateOptions,
  ): Promise<AiGenerateResult> {
    const candidates = this.config.geminiApiKeys.filter(
      ({ slot }) => (this.unavailableUntil.get(slot) || 0) <= Date.now(),
    );
    if (candidates.length === 0) {
      throw new Error('GEMINI_PROVIDER_UNAVAILABLE');
    }
    let finalError: Error | undefined;
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const candidate = candidates[attempt];
      try {
        return await this.generateForKey(prompt, options, candidate.key, candidate.slot, attempt + 1);
      } catch (err: unknown) {
        finalError = err instanceof Error ? err : new Error(String(err));
        const status = this.statusFromError(finalError);
        const retryable = status !== undefined && [401, 403, 408, 429, 500, 502, 503, 504].includes(status);
        if (!retryable) throw finalError;
        this.unavailableUntil.set(candidate.slot, Date.now() + this.config.geminiKeyCooldownSeconds * 1000);
        this.logger.warn(`[GeminiTelemetry] provider=gemini keySlot=${candidate.slot} status=${status} failover=${attempt < candidates.length - 1} attempt=${attempt + 1}`);
      }
    }
    throw finalError || new Error('GEMINI_PROVIDER_UNAVAILABLE');
  }

  private async generateForKey(
    prompt: string,
    options: AiGenerateOptions | undefined,
    apiKey: string,
    keySlot: number,
    failoverAttempt: number,
  ): Promise<AiGenerateResult> {
    const model = this.config.geminiModel;
    const timeoutMs: number = Number(
      options?.timeoutMs || this.config.geminiTimeoutMs,
    );
    const maxRetries: number = Number(
      options?.maxRetries || this.config.geminiMaxRetries,
    );
    const telemetryLabel = options?.telemetryLabel;
    const emitDiagnostics = Boolean(
      telemetryLabel && this.config.nodeEnv === 'development',
    );
    const inlineMimeTypes = (options?.inlineData || [])
      .map((attachment) => attachment.mimeType)
      .join(',') || 'none';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const contents: any[] = [];
    contents.push({
      role: 'user',
      parts: [
        { text: prompt },
        ...(options?.inlineData || []).map((attachment) => ({
          inlineData: {
            mimeType: attachment.mimeType,
            data: Buffer.isBuffer(attachment.data)
              ? attachment.data.toString('base64')
              : attachment.data,
          },
        })),
      ],
    });

    const body: Record<string, unknown> = {
      contents,
      ...(options?.systemPrompt
        ? { systemInstruction: { parts: [{ text: options.systemPrompt }] } }
        : {}),
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: Number(options?.maxTokens || this.config.aiMaxOutputLength),
        ...(options?.responseFormat === 'json'
          ? { responseMimeType: 'application/json', ...(options.jsonSchema ? { responseSchema: options.jsonSchema } : {}) }
          : {}),
        ...(options?.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: options.thinkingLevel } }
          : {}),
      },
    };

    let attempt = 0;
    let lastError: Error | null = null;
    const requestStartedAt = Date.now();

    while (attempt < maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const failure = (await res.json().catch(() => ({}))) as Record<string, any>;
          const providerError = failure['error'] as Record<string, unknown> | undefined;
          const providerCategory = this.classifyHttpStatus(res.status, providerError?.['status']);
          const providerMessage =
            typeof providerError?.['message'] === 'string'
              ? providerError['message'].replace(/[\r\n]+/g, ' ').slice(0, 240)
              : 'unavailable';
          if (emitDiagnostics) {
            this.logger.warn(
              `[${telemetryLabel}] model=${model} mime=${inlineMimeTypes} response_format=${options?.responseFormat || 'text'} response_schema=${Boolean(options?.jsonSchema)} request=completed provider_status=${res.status} provider_category=${providerCategory} provider_message=${providerMessage} elapsed_ms=${Date.now() - requestStartedAt}`,
            );
          }
          throw new Error(`Gemini API returned status ${res.status} (${providerCategory})`);
        }

        const data = (await res.json()) as Record<string, unknown>;
        const candidates =
          (data['candidates'] as Array<Record<string, unknown>>) || [];
        let finishReason = 'UNKNOWN';
        let textContent = '';
        // Gemini may return multiple candidates and multiple parts. Prefer the
        // first candidate with visible, non-thought text.
        for (const candidate of candidates) {
          const parts =
            ((candidate.content as Record<string, unknown>)?.parts as Array<
              Record<string, unknown>
            >) || [];
          const candidateText = parts
            .filter((part) => part['thought'] !== true && typeof part['text'] === 'string')
            .map((part) => part['text'] as string)
            .join('\n');
          if (candidateText) {
            textContent = candidateText;
            finishReason =
              (typeof candidate['finishReason'] === 'string' && candidate['finishReason']) ||
              'UNKNOWN';
            break;
          }
        }

        let jsonObj: Record<string, any> | undefined;
        if (options?.responseFormat === 'json' && textContent) {
          jsonObj = this.parseStructuredJson(textContent);
          if (!jsonObj) {
            this.logger.warn(
              `[GeminiTelemetry] provider=gemini keySlot=${keySlot} json_parse=false response_chars=${textContent.length}`,
            );
          }
        }

        const usageMeta =
          (data['usageMetadata'] as Record<string, number>) || {};

        const durationMs = Date.now() - requestStartedAt;
        if (emitDiagnostics) {
          this.logger.log(
            `[${telemetryLabel}] model=${model} mime=${inlineMimeTypes} request=completed provider_status=200 candidate_count=${candidates.length} finish_reason=${finishReason} text_present=${Boolean(textContent)} json_detected=${Boolean(jsonObj)} elapsed_ms=${durationMs}`,
          );
        }
        this.logger.log(
          `[GeminiTelemetry] provider=gemini keySlot=${keySlot} status=success failover=${failoverAttempt > 1} attempts=${attempt} duration_ms=${durationMs} prompt_chars=${prompt.length} system_chars=${options?.systemPrompt?.length || 0}`,
        );
        return {
          text: textContent,
          json: jsonObj,
          usage: {
            promptTokens: usageMeta['promptTokenCount'] || 0,
            completionTokens: usageMeta['candidatesTokenCount'] || 0,
            totalTokens: usageMeta['totalTokenCount'] || 0,
          },
          provider: 'gemini',
          model,
        };
      } catch (err: unknown) {
        clearTimeout(timer);
        const errMsg = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(errMsg);
        const status = this.statusFromError(lastError);
        this.logger.warn(
          `[GeminiTelemetry] provider=gemini keySlot=${keySlot} status=failed category=${this.classifyHttpStatus(status)} response_format=${options?.responseFormat || 'text'} response_schema=${Boolean(options?.jsonSchema)} attempt=${attempt}/${maxRetries} duration_ms=${Date.now() - requestStartedAt} prompt_chars=${prompt.length} system_chars=${options?.systemPrompt?.length || 0} error=${lastError.message}`,
        );
        const retryable = status === undefined || [408, 429, 500, 502, 503, 504].includes(status);
        if (attempt < maxRetries && retryable) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 200));
        } else if (!retryable) {
          break;
        }
      }
    }

    throw lastError || new Error('Gemini execution failed after retries');
  }

  private statusFromError(error: Error): number | undefined {
    const match = error.message.match(/status\s+(\d{3})/i);
    return match ? Number(match[1]) : undefined;
  }

  private classifyHttpStatus(status?: number, providerStatus?: unknown): string {
    if (status === 400) return 'INVALID_ARGUMENT';
    if (status === 401) return 'AUTHENTICATION';
    if (status === 403) return 'AUTHORIZATION';
    if (status === 429) return 'RATE_LIMITED';
    if (status !== undefined && status >= 500) return 'PROVIDER_ERROR';
    return typeof providerStatus === 'string' ? providerStatus : status === undefined ? 'TRANSPORT_ERROR' : `HTTP_${status}`;
  }

  /** Transport-only normalization. It never converts prose into a response. */
  private parseStructuredJson(text: string): Record<string, any> | undefined {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const candidates = [trimmed];
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, any>;
        }
      } catch {
        // Continue only with another safe JSON envelope candidate.
      }
    }
    return undefined;
  }

  async classify(
    text: string,
    options?: AiClassifyOptions,
  ): Promise<AiClassifyResult> {
    const candidates = options?.candidateCategories || [];
    const prompt = `Classify the following medical/health query into exactly ONE category from this list: [${candidates.join(
      ', ',
    )}].
Output JSON only in this exact format: {"category": "<SELECTED_CATEGORY>", "confidence": <NUMBER_0_TO_1>, "explanation": "<REASON>"}.

Query: "${text}"`;

    const result = await this.generate(prompt, {
      responseFormat: 'json',
      temperature: 0.0,
      correlationId: options?.correlationId,
    });

    const parsed = (result.json as Record<string, unknown>) || {};
    const category =
      (parsed['category'] as string) || candidates[0] || 'UNKNOWN';
    const confidence =
      typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 0.8;

    return {
      category,
      confidence,
      explanation: (parsed['explanation'] as string) || 'Gemini classification',
      provider: 'gemini',
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    await Promise.resolve();
    if (this.config.geminiApiKeys.length === 0) {
      return {
        status: 'NOT_CONFIGURED',
        details: 'Gemini API key is not configured',
      };
    }
    return {
      status: 'AVAILABLE',
      details: `Gemini model ${this.config.geminiModel} is configured`,
    };
  }
}
