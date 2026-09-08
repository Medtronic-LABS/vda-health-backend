import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigurationService } from '../configuration/configuration.service';
import {
  STTProvider,
  STTRequest,
  STTResponse,
  VoiceSttProviderName,
} from '../ai/interfaces/stt-provider.interface';
import { TTSProvider, TTSRequest, TTSResponse } from '../ai/interfaces/tts-provider.interface';
import { SarvamSttProvider } from './stt/sarvam-stt.provider';
import { SravaaniSttProvider } from './stt/sravaani-stt.provider';
import {
  ProviderTranscription,
  SpeechToTextProvider,
  SpeechToTextProviderError,
} from './stt/speech-to-text-provider.interface';

@Injectable()
export class VoiceService implements STTProvider, TTSProvider {
  constructor(
    private readonly config: ConfigurationService,
    private readonly sravaani: SravaaniSttProvider,
    private readonly sarvamStt: SarvamSttProvider,
  ) {}

  /** One configured primary attempt followed by, at most, one configured fallback. */
  async transcribe(request: STTRequest): Promise<STTResponse> {
    if (!request.audioBuffer?.length) {
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    }

    const primaryName = request.requestedProvider || this.config.voiceSttProvider;
    try {
      const result = await this.providerFor(primaryName).transcribe(request);
      return this.toSttResponse(result, primaryName, primaryName, false);
    } catch (primaryError) {
      const fallbackName = this.config.voiceSttFallbackProvider;
      const canFallback = this.config.voiceSttFallbackEnabled && fallbackName !== primaryName;
      if (!canFallback) throw this.toPublicError(primaryError);
      try {
        const result = await this.providerFor(fallbackName).transcribe(request);
        return this.toSttResponse(
          result,
          fallbackName,
          primaryName,
          true,
          this.failureCategory(primaryError),
        );
      } catch {
        throw this.toPublicError(primaryError);
      }
    }
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    }
    const text = request.text?.trim();
    if (!text || text.length > 2500) {
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    }
    const response = await this.request('/text-to-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        language_code: request.languageCode || 'hi-IN',
        model: this.config.sarvamBulbulTtsModel || 'bulbul:v3',
        speaker: request.voiceId || 'shubh',
        output_audio_codec: 'mp3',
      }),
    });
    const data = (await response.json()) as { audios?: string[] };
    const encoded = data.audios?.[0];
    if (!encoded) throw new ServiceUnavailableException('Voice service is currently unavailable.');
    return {
      audioBuffer: Buffer.from(encoded, 'base64'),
      mimeType: 'audio/mpeg',
      provider: 'sarvam',
      model: this.config.sarvamBulbulTtsModel || 'bulbul:v3',
    };
  }

  isAvailable(): boolean {
    return this.config.sarvamEnabled && Boolean(this.config.sarvamApiKey);
  }

  sttPrimaryProvider(requestedProvider?: VoiceSttProviderName): VoiceSttProviderName {
    return requestedProvider || this.config.voiceSttProvider;
  }

  private providerFor(name: VoiceSttProviderName): SpeechToTextProvider {
    return name === 'sravaani' ? this.sravaani : this.sarvamStt;
  }

  private toSttResponse(
    result: ProviderTranscription,
    provider: VoiceSttProviderName,
    primaryProvider: VoiceSttProviderName,
    fallbackUsed: boolean,
    fallbackReason?: string,
  ): STTResponse {
    return {
      transcript: result.transcript,
      confidence: result.confidence,
      detectedLanguage: result.detectedLanguage,
      provider,
      primaryProvider,
      model: result.model,
      fallbackUsed,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  }

  private failureCategory(error: unknown): string {
    return error instanceof SpeechToTextProviderError ? error.category : 'INFERENCE_FAILED';
  }

  private toPublicError(error: unknown): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: 'Voice service is currently unavailable.',
      category: this.failureCategory(error),
    });
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
      if (!response.ok) throw new ServiceUnavailableException('Voice service is currently unavailable.');
      return response;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}
