import { Injectable } from '@nestjs/common';
import { TTSRequest } from '../../ai/interfaces/tts-provider.interface';
import { ConfigurationService } from '../../configuration/configuration.service';
import {
  ProviderSynthesis,
  TextToSpeechProvider,
  TextToSpeechProviderError,
} from './text-to-speech-provider.interface';

/** Existing hosted TTS integration, retained as the controlled fallback. */
@Injectable()
export class SarvamTtsProvider implements TextToSpeechProvider {
  readonly name = 'sarvam' as const;

  constructor(private readonly config: ConfigurationService) {}

  async synthesize(input: TTSRequest): Promise<ProviderSynthesis> {
    if (!this.config.sarvamEnabled || !this.config.sarvamApiKey) {
      throw new TextToSpeechProviderError('NOT_CONFIGURED', 'Sarvam TTS is not configured.');
    }
    const response = await this.request('/text-to-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        language_code: input.languageCode || 'hi-IN',
        model: this.config.sarvamBulbulTtsModel || 'bulbul:v3',
        speaker: input.voiceId || 'shubh',
        output_audio_codec: 'mp3',
      }),
    });
    const data = (await response.json()) as { audios?: string[] };
    const encoded = data.audios?.[0];
    if (!encoded) {
      throw new TextToSpeechProviderError('MODEL_INFERENCE_FAILED', 'Sarvam TTS returned no audio.');
    }
    return {
      audioBuffer: Buffer.from(encoded, 'base64'),
      mimeType: 'audio/mpeg',
      model: this.config.sarvamBulbulTtsModel || 'bulbul:v3',
    };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.sarvamTimeoutMs);
    try {
      const response = await fetch(`${this.config.sarvamBaseUrl}${path}`, {
        ...init,
        headers: { 'api-subscription-key': this.config.sarvamApiKey!, ...(init.headers || {}) },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new TextToSpeechProviderError('SERVICE_UNAVAILABLE', `Sarvam TTS returned HTTP ${response.status}.`);
      }
      return response;
    } catch (error) {
      if (error instanceof TextToSpeechProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TextToSpeechProviderError('PROVIDER_TIMEOUT', 'Sarvam TTS timed out.');
      }
      throw new TextToSpeechProviderError('SERVICE_UNAVAILABLE', 'Sarvam TTS is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}
