import { Injectable, Logger } from '@nestjs/common';
import { TTSRequest } from '../../ai/interfaces/tts-provider.interface';
import { ConfigurationService } from '../../configuration/configuration.service';
import {
  ProviderSynthesis,
  TextToSpeechFailureCategory,
  TextToSpeechProvider,
  TextToSpeechProviderError,
} from './text-to-speech-provider.interface';

/** Client for the private, persistent local DhVaani TTS service. */
@Injectable()
export class DhvaaniTtsProvider implements TextToSpeechProvider {
  readonly name = 'dhvaani' as const;
  private readonly logger = new Logger(DhvaaniTtsProvider.name);

  constructor(private readonly config: ConfigurationService) {}

  async synthesize(input: TTSRequest): Promise<ProviderSynthesis> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.voiceTtsTimeoutMs);
    try {
      const response = await fetch(`${this.config.dhvaaniBaseUrl}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The response text is sent only to the local TTS service. It is never
        // logged here and is not attached to telemetry.
        body: JSON.stringify({ text: input.text, language_code: input.languageCode || 'hi-IN' }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const category = await this.failureCategory(response);
        this.logger.warn(`DhVaani TTS failure status=${response.status} category=${category}`);
        throw new TextToSpeechProviderError(category, `DhVaani TTS returned HTTP ${response.status}.`);
      }
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      if (!audioBuffer.length) {
        throw new TextToSpeechProviderError('MODEL_INFERENCE_FAILED', 'DhVaani TTS returned no audio.');
      }
      return {
        audioBuffer,
        mimeType: response.headers.get('content-type')?.split(';', 1)[0] || 'audio/wav',
        model: response.headers.get('x-vda-tts-model') || 'ARTPARK-IISc/DhVaani-0.5',
      };
    } catch (error) {
      if (error instanceof TextToSpeechProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn('DhVaani TTS failure category=PROVIDER_TIMEOUT');
        throw new TextToSpeechProviderError('PROVIDER_TIMEOUT', 'DhVaani TTS timed out.');
      }
      this.logger.warn('DhVaani TTS failure category=SERVICE_UNAVAILABLE');
      throw new TextToSpeechProviderError('SERVICE_UNAVAILABLE', 'DhVaani TTS is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async failureCategory(response: Response): Promise<TextToSpeechFailureCategory> {
    const body = await response.json().catch(() => undefined) as { detail?: unknown } | undefined;
    const detail = body?.detail;
    const category = typeof detail === 'object' && detail !== null && 'category' in detail
      ? (detail as { category?: unknown }).category
      : undefined;
    return this.isFailureCategory(category) ? category : 'SERVICE_UNAVAILABLE';
  }

  private isFailureCategory(value: unknown): value is TextToSpeechFailureCategory {
    return typeof value === 'string' && [
      'NOT_CONFIGURED', 'SERVICE_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'MODEL_UNAVAILABLE',
      'REFERENCE_UNAVAILABLE', 'MODEL_INFERENCE_FAILED', 'INVALID_TEXT',
    ].includes(value);
  }
}
