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
import type { SchemeInformationType } from '../../intents/intent.types';

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
        return await this.generateForKey(
          prompt,
          options,
          candidate.key,
          candidate.slot,
          attempt + 1,
        );
      } catch (err: unknown) {
        finalError = err instanceof Error ? err : new Error(String(err));
        const status = this.statusFromError(finalError);
        const retryable =
          status !== undefined &&
          [401, 403, 408, 429, 500, 502, 503, 504].includes(status);
        if (!retryable) throw finalError;
        this.unavailableUntil.set(
          candidate.slot,
          Date.now() + this.config.geminiKeyCooldownSeconds * 1000,
        );
        this.logger.warn(
          `[GeminiTelemetry] provider=gemini keySlot=${candidate.slot} status=${status} failover=${attempt < candidates.length - 1} attempt=${attempt + 1}`,
        );
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
    const inlineMimeTypes =
      (options?.inlineData || [])
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
        maxOutputTokens: Number(
          options?.maxTokens || this.config.aiMaxOutputLength,
        ),
        ...(options?.responseFormat === 'json'
          ? {
              responseMimeType: 'application/json',
              ...(options.jsonSchema
                ? { responseSchema: options.jsonSchema }
                : {}),
            }
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
          const failure = (await res.json().catch(() => ({}))) as Record<
            string,
            any
          >;
          const providerError = failure['error'] as
            Record<string, unknown> | undefined;
          const providerCategory = this.classifyHttpStatus(
            res.status,
            providerError?.['status'],
          );
          const providerMessage =
            typeof providerError?.['message'] === 'string'
              ? providerError['message'].replace(/[\r\n]+/g, ' ').slice(0, 240)
              : 'unavailable';
          if (emitDiagnostics) {
            this.logger.warn(
              `[${telemetryLabel}] model=${model} mime=${inlineMimeTypes} response_format=${options?.responseFormat || 'text'} response_schema=${Boolean(options?.jsonSchema)} request=completed provider_status=${res.status} provider_category=${providerCategory} provider_message=${providerMessage} elapsed_ms=${Date.now() - requestStartedAt}`,
            );
          }
          throw new Error(
            `Gemini API returned status ${res.status} (${providerCategory})`,
          );
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
            .filter(
              (part) =>
                part['thought'] !== true && typeof part['text'] === 'string',
            )
            .map((part) => part['text'] as string)
            .join('\n');
          if (candidateText) {
            textContent = candidateText;
            finishReason =
              (typeof candidate['finishReason'] === 'string' &&
                candidate['finishReason']) ||
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
        const usageReported = [
          'promptTokenCount',
          'candidatesTokenCount',
          'totalTokenCount',
        ].some((key) => Number.isFinite(usageMeta[key]));

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
          usage: usageReported
            ? {
                promptTokens: usageMeta['promptTokenCount'] || 0,
                completionTokens: usageMeta['candidatesTokenCount'] || 0,
                totalTokens: usageMeta['totalTokenCount'] || 0,
                providerReportedTotalTokens:
                  usageMeta['totalTokenCount'] || 0,
                ...(Number.isFinite(usageMeta['thoughtsTokenCount'])
                  ? { thoughtsTokens: usageMeta['thoughtsTokenCount'] }
                  : {}),
                ...(Number.isFinite(usageMeta['cachedContentTokenCount'])
                  ? {
                      cachedContentTokens:
                        usageMeta['cachedContentTokenCount'],
                    }
                  : {}),
                ...(Number.isFinite(usageMeta['toolUsePromptTokenCount'])
                  ? {
                      toolUsePromptTokens:
                        usageMeta['toolUsePromptTokenCount'],
                    }
                  : {}),
              }
            : undefined,
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
        const retryable =
          status === undefined ||
          [408, 429, 500, 502, 503, 504].includes(status);
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

  private classifyHttpStatus(
    status?: number,
    providerStatus?: unknown,
  ): string {
    if (status === 400) return 'INVALID_ARGUMENT';
    if (status === 401) return 'AUTHENTICATION';
    if (status === 403) return 'AUTHORIZATION';
    if (status === 429) return 'RATE_LIMITED';
    if (status !== undefined && status >= 500) return 'PROVIDER_ERROR';
    return typeof providerStatus === 'string'
      ? providerStatus
      : status === undefined
        ? 'TRANSPORT_ERROR'
        : `HTTP_${status}`;
  }

  /** Transport-only normalization. It never converts prose into a response. */
  private parseStructuredJson(text: string): Record<string, any> | undefined {
    const trimmed = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const candidates = [trimmed];
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start)
      candidates.push(trimmed.slice(start, end + 1));
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
    const prompt = `You classify one patient message for an NCD-focused VDA. Use the current query and privacy-sanitized recent conversation to resolve references and follow-ups semantically. Select exactly ONE supported capability from: [${candidates.join(
      ', ',
    )}]. Do not give medical advice or generate a patient answer. If genuinely ambiguous or outside those capabilities, select UNKNOWN with low confidence. Infer language "hi" for Hindi/Hinglish and "en" for English. Choose only the minimum patient-record categories needed from MEDICATION, PRESCRIPTION, DIAGNOSIS, LAB_REPORT, INVESTIGATION, ALLERGY, CARE_PLAN; never request every category. Set knowledgeRequired only when governed knowledge is needed beyond patient records. For FACILITY_QUERY and REFERRAL_QUERY, extract only expressed or retained constraints. When the patient explicitly asks where to obtain a diagnostic, treatment, or other health service, put the concise requested service in requirements.service and at most five unambiguous names, spellings, or acronyms for that same service in requirements.serviceAliases. Do not add broader departments, related tests, or capabilities the patient did not request. Set costPreference to LOW_COST only when the patient explicitly requests an affordable, low-cost, free, or low-expense option, including Hindi/Hinglish equivalents. This is an access preference, not proof that a service is free or covered. Normalize an explicitly requested facility level to HWC_SHC, HWC_PHC, CHC, SDH, or DH. Normalize an explicitly requested referral tier to PRIMARY, SECONDARY, or DISTRICT. For GOVERNMENT_SCHEME_QUERY, classify the requested information semantically as exactly one of SCHEME_OVERVIEW, SCHEME_AVAILABILITY, SCHEME_ELIGIBILITY, SCHEME_DOCUMENTS, SCHEME_APPLICATION, SCHEME_BENEFITS, SCHEME_FACILITY, SCHEME_COMPARISON, or SCHEME_UNKNOWN. Resolve references such as "iske" from the retained conversation; do not infer a scheme name that was not stated or retained. responseRequirements may only contain GROUNDED_GUIDANCE, ALL_RECORD_ITEMS, VALUE_AND_UNCERTAINTY, CARE_PLAN_ITEMS, PRESCRIPTION_DOCUMENT_CONTEXT.
Output JSON only: {"category":"<SELECTED_CATEGORY>","confidence":<NUMBER_0_TO_1>,"language":"hi|en","explanation":"<SHORT_REASON>","requirements":{"state":null,"district":null,"facilityType":null,"costPreference":null,"iphsLevel":null,"referralLevel":null,"scheme":null,"service":null,"serviceAliases":[],"recordCategories":[],"knowledgeRequired":false,"responseRequirements":[],"schemeInformationType":null}}.

Recent conversation context (may be empty):
${options?.conversationContext || '(none)'}

Current query: "${text}"`;

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
      requirements: this.parseRequirements(parsed['requirements']),
      language:
        parsed['language'] === 'hi' || parsed['language'] === 'en'
          ? parsed['language']
          : undefined,
      usage: result.usage,
      provider: 'gemini',
    };
  }

  private parseRequirements(value: unknown): AiClassifyResult['requirements'] {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined;
    const raw = value as Record<string, unknown>;
    const stringValue = (key: string) =>
      typeof raw[key] === 'string' && raw[key].trim()
        ? raw[key].trim().slice(0, 120)
        : undefined;
    const facilityType = stringValue('facilityType')?.toUpperCase();
    const costPreference = stringValue('costPreference')?.toUpperCase();
    const iphsLevel = stringValue('iphsLevel')?.toUpperCase();
    const referralLevel = stringValue('referralLevel')?.toUpperCase();
    const schemeInformationType = stringValue('schemeInformationType');
    return {
      state: stringValue('state'),
      district: stringValue('district'),
      facilityType:
        facilityType === 'PUBLIC' || facilityType === 'PRIVATE'
          ? facilityType
          : undefined,
      costPreference:
        costPreference === 'LOW_COST' ? costPreference : undefined,
      iphsLevel: ['HWC_SHC', 'HWC_PHC', 'CHC', 'SDH', 'DH'].includes(
        iphsLevel || '',
      )
        ? (iphsLevel as NonNullable<
            AiClassifyResult['requirements']
          >['iphsLevel'])
        : undefined,
      referralLevel: ['PRIMARY', 'SECONDARY', 'DISTRICT'].includes(
        referralLevel || '',
      )
        ? (referralLevel as NonNullable<
            AiClassifyResult['requirements']
          >['referralLevel'])
        : undefined,
      scheme: stringValue('scheme'),
      service: stringValue('service'),
      serviceAliases: Array.isArray(raw['serviceAliases'])
        ? raw['serviceAliases']
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 5)
        : undefined,
      recordCategories: Array.isArray(raw['recordCategories'])
        ? raw['recordCategories']
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, 4)
        : undefined,
      knowledgeRequired:
        typeof raw['knowledgeRequired'] === 'boolean'
          ? raw['knowledgeRequired']
          : undefined,
      responseRequirements: Array.isArray(raw['responseRequirements'])
        ? raw['responseRequirements']
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, 3)
        : undefined,
      schemeInformationType: [
        'SCHEME_OVERVIEW',
        'SCHEME_AVAILABILITY',
        'SCHEME_ELIGIBILITY',
        'SCHEME_DOCUMENTS',
        'SCHEME_APPLICATION',
        'SCHEME_BENEFITS',
        'SCHEME_FACILITY',
        'SCHEME_COMPARISON',
        'SCHEME_UNKNOWN',
      ].includes(schemeInformationType || '')
        ? (schemeInformationType as SchemeInformationType)
        : undefined,
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
