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

  constructor(private readonly config: ConfigurationService) {}

  async generate(
    prompt: string,
    options?: AiGenerateOptions,
  ): Promise<AiGenerateResult> {
    const apiKey = this.config.geminiApiKey;
    const model = this.config.geminiModel;
    const timeoutMs: number = Number(
      options?.timeoutMs || this.config.geminiTimeoutMs,
    );
    const maxRetries: number = Number(
      options?.maxRetries || this.config.geminiMaxRetries,
    );

    if (!apiKey) {
      this.logger.warn('Gemini API Key is missing');
      throw new Error('GEMINI_NOT_CONFIGURED');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const contents: any[] = [];
    if (options?.systemPrompt) {
      contents.push({
        role: 'user',
        parts: [{ text: `[SYSTEM INSTRUCTION]\n${options.systemPrompt}` }],
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: this.config.aiMaxOutputLength,
        ...(options?.responseFormat === 'json'
          ? { responseMimeType: 'application/json' }
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
          throw new Error(`Gemini API returned status ${res.status}`);
        }

        const data = (await res.json()) as Record<string, unknown>;
        const candidates =
          (data['candidates'] as Array<Record<string, unknown>>) || [];
        const textContent =
          ((
            (candidates[0]?.content as Record<string, unknown>)?.parts as Array<
              Record<string, unknown>
            >
          )?.[0]?.text as string) || '';

        let jsonObj: Record<string, any> | undefined;
        if (options?.responseFormat === 'json' && textContent) {
          try {
            jsonObj = JSON.parse(textContent) as Record<string, any>;
          } catch {
            this.logger.warn('Failed to parse Gemini JSON output');
          }
        }

        const usageMeta =
          (data['usageMetadata'] as Record<string, number>) || {};

        const durationMs = Date.now() - requestStartedAt;
        this.logger.log(
          `[GeminiTelemetry] status=success model=${model} attempts=${attempt} duration_ms=${durationMs} prompt_chars=${prompt.length} system_chars=${options?.systemPrompt?.length || 0}`,
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
        this.logger.warn(
          `[GeminiTelemetry] status=failed model=${model} attempt=${attempt}/${maxRetries} duration_ms=${Date.now() - requestStartedAt} prompt_chars=${prompt.length} system_chars=${options?.systemPrompt?.length || 0} error=${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 200));
        }
      }
    }

    throw lastError || new Error('Gemini execution failed after retries');
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
    const apiKey = this.config.geminiApiKey;
    if (!apiKey) {
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
