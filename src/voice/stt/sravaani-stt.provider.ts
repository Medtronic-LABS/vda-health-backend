import { Injectable, Logger } from '@nestjs/common';
import { ConfigurationService } from '../../configuration/configuration.service';
import {
  ProviderTranscription,
  SpeechToTextInput,
  SpeechToTextProvider,
  SpeechToTextFailureCategory,
  SpeechToTextProviderError,
} from './speech-to-text-provider.interface';

/** Client for the private, persistent local SraVaani Python service. */
@Injectable()
export class SravaaniSttProvider implements SpeechToTextProvider {
  readonly name = 'sravaani' as const;
  private readonly logger = new Logger(SravaaniSttProvider.name);

  constructor(private readonly config: ConfigurationService) {}

  async transcribe(input: SpeechToTextInput): Promise<ProviderTranscription> {
    const mimeType = (input.mimeType || 'audio/webm').split(';', 1)[0].toLowerCase();
    const extension = this.extensionFor(mimeType);
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(input.audioBuffer)], { type: mimeType }),
      `recording${extension}`,
    );
    if (input.languageHint) form.append('language_hint', input.languageHint);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.voiceSttTimeoutMs);
    try {
      const response = await fetch(`${this.config.sravaaniBaseUrl}/transcribe`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = await this.failureFrom(response);
        this.logFailure(failure.category, mimeType, extension, input.audioBuffer.length, failure.stage, response.status);
        throw new SpeechToTextProviderError(
          failure.category,
          `SraVaani STT returned HTTP ${response.status}.`,
        );
      }
      const data = (await response.json()) as Record<string, unknown>;
      const transcript = typeof data.transcript === 'string' ? data.transcript.trim() : '';
      if (!transcript) {
        throw new SpeechToTextProviderError('INFERENCE_FAILED', 'SraVaani returned an empty transcript.');
      }
      return {
        transcript,
        detectedLanguage: typeof data.detected_language === 'string' ? data.detected_language : undefined,
        confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
        model: typeof data.model === 'string' ? data.model : 'ARTPARK-IISc/SraVaani-0.5-live',
      };
    } catch (error) {
      if (error instanceof SpeechToTextProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        this.logFailure('PROVIDER_TIMEOUT', mimeType, extension, input.audioBuffer.length, 'sravaani_request');
        throw new SpeechToTextProviderError('PROVIDER_TIMEOUT', 'SraVaani STT timed out.');
      }
      this.logFailure('SERVICE_UNAVAILABLE', mimeType, extension, input.audioBuffer.length, 'sravaani_request');
      throw new SpeechToTextProviderError('SERVICE_UNAVAILABLE', 'SraVaani STT is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }

  private extensionFor(mimeType: string): string {
    if (mimeType === 'audio/mp4' || mimeType === 'audio/x-m4a') return '.m4a';
    if (mimeType === 'audio/mpeg') return '.mp3';
    if (mimeType === 'audio/ogg') return '.ogg';
    if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return '.wav';
    return '.webm';
  }

  private async failureFrom(response: Response): Promise<{ category: SpeechToTextFailureCategory; stage: string }> {
    const body = await response.json().catch(() => undefined) as { detail?: unknown } | undefined;
    const detail = body?.detail;
    const category = typeof detail === 'object' && detail !== null && 'category' in detail
      ? (detail as { category?: unknown }).category
      : undefined;
    const stage = typeof detail === 'object' && detail !== null && 'stage' in detail
      ? (detail as { stage?: unknown }).stage
      : undefined;
    return {
      category: this.isFailureCategory(category)
        ? category
        : response.status === 415 ? 'UNSUPPORTED_AUDIO' : 'SERVICE_UNAVAILABLE',
      stage: typeof stage === 'string' ? stage : 'sravaani_http',
    };
  }

  private isFailureCategory(value: unknown): value is SpeechToTextFailureCategory {
    return typeof value === 'string' && [
      'NOT_CONFIGURED', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'UNSUPPORTED_AUDIO',
      'AUDIO_DECODE_FAILED', 'INVALID_AUDIO', 'MODEL_INFERENCE_FAILED',
      'MODEL_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'INFERENCE_FAILED',
    ].includes(value);
  }

  private logFailure(category: string, mimeType: string, extension: string, audioBytes: number, failureStage: string, status?: number): void {
    this.logger.warn(`SraVaani STT failure status=${status ?? 'request_error'} category=${category} mimeType=${mimeType} extension=${extension} audioBytes=${audioBytes} failureStage=${failureStage}`);
  }
}
