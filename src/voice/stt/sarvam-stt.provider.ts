import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../configuration/configuration.service';
import {
  ProviderTranscription,
  SpeechToTextInput,
  SpeechToTextProvider,
  SpeechToTextProviderError,
} from './speech-to-text-provider.interface';

@Injectable()
export class SarvamSttProvider implements SpeechToTextProvider {
  readonly name = 'sarvam' as const;

  constructor(private readonly config: ConfigurationService) {}

  async transcribe(input: SpeechToTextInput): Promise<ProviderTranscription> {
    if (!this.config.sarvamEnabled || !this.config.sarvamApiKey) {
      throw new SpeechToTextProviderError('NOT_CONFIGURED', 'Sarvam STT is not configured.');
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.audioBuffer)], { type: input.mimeType || 'audio/webm' }),
      'recording.webm',
    );
    form.append('model', this.config.sarvamSaarasSttModel || 'saaras:v3');
    form.append('mode', 'transcribe');
    if (input.languageHint) form.append('language_code', input.languageHint);

    const data = await this.request('/speech-to-text', { method: 'POST', body: form });
    const transcript = typeof data.transcript === 'string' ? data.transcript.trim() : '';
    if (!transcript) {
      throw new SpeechToTextProviderError('INFERENCE_FAILED', 'Sarvam returned an empty transcript.');
    }
    return {
      transcript,
      detectedLanguage: typeof data.language_code === 'string' ? data.language_code : undefined,
      confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
      model: this.config.sarvamSaarasSttModel || 'saaras:v3',
    };
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.sarvamTimeoutMs);
    try {
      const response = await fetch(`${this.config.sarvamBaseUrl}${path}`, {
        ...init,
        headers: { 'api-subscription-key': this.config.sarvamApiKey!, ...(init.headers || {}) },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SpeechToTextProviderError(
          response.status === 415 ? 'UNSUPPORTED_AUDIO' : 'SERVICE_UNAVAILABLE',
          `Sarvam STT returned HTTP ${response.status}.`,
        );
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SpeechToTextProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SpeechToTextProviderError('TIMEOUT', 'Sarvam STT timed out.');
      }
      throw new SpeechToTextProviderError('SERVICE_UNAVAILABLE', 'Sarvam STT is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}
