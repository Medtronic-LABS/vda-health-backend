import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigurationService } from '../configuration/configuration.service';
import {
  STTProvider,
  STTRequest,
  STTResponse,
  VoiceSttProviderName,
} from '../ai/interfaces/stt-provider.interface';
import {
  TTSProvider,
  TTSRequest,
  TTSResponse,
  VoiceTtsProviderName,
} from '../ai/interfaces/tts-provider.interface';
import { SarvamSttProvider } from './stt/sarvam-stt.provider';
import { SravaaniSttProvider } from './stt/sravaani-stt.provider';
import {
  ProviderTranscription,
  SpeechToTextProvider,
  SpeechToTextProviderError,
} from './stt/speech-to-text-provider.interface';
import { DhvaaniTtsProvider } from './tts/dhvaani-tts.provider';
import {
  ProviderSynthesis,
  TextToSpeechProvider,
  TextToSpeechProviderError,
} from './tts/text-to-speech-provider.interface';
import { SarvamTtsProvider } from './tts/sarvam-tts.provider';

@Injectable()
export class VoiceService implements STTProvider, TTSProvider {
  constructor(
    private readonly config: ConfigurationService,
    private readonly sravaani: SravaaniSttProvider,
    private readonly sarvamStt: SarvamSttProvider,
    private readonly dhvaaniTts: DhvaaniTtsProvider,
    private readonly sarvamTts: SarvamTtsProvider,
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
    const text = request.text?.trim();
    if (!text || text.length > 2500) {
      throw new ServiceUnavailableException('Voice service is currently unavailable.');
    }
    const primaryProvider = this.ttsPrimaryProvider();
    try {
      const result = await this.ttsProviderFor(primaryProvider).synthesize({ ...request, text });
      return this.toTtsResponse(result, primaryProvider, primaryProvider, false);
    } catch (primaryError) {
      const fallbackProvider = this.config.voiceTtsFallbackProvider;
      const canFallback = this.config.voiceTtsFallbackEnabled && fallbackProvider !== primaryProvider;
      if (!canFallback) throw this.toTtsPublicError(primaryError);
      try {
        const result = await this.ttsProviderFor(fallbackProvider).synthesize({ ...request, text });
        return this.toTtsResponse(
          result,
          fallbackProvider,
          primaryProvider,
          true,
          this.ttsFailureCategory(primaryError),
        );
      } catch {
        throw this.toTtsPublicError(primaryError);
      }
    }
  }

  sttPrimaryProvider(requestedProvider?: VoiceSttProviderName): VoiceSttProviderName {
    return requestedProvider || this.config.voiceSttProvider;
  }

  ttsPrimaryProvider(): VoiceTtsProviderName {
    return this.config.voiceTtsProvider;
  }

  ttsPrimaryModel(): string {
    return this.ttsPrimaryProvider() === 'dhvaani'
      ? 'ARTPARK-IISc/DhVaani-0.5'
      : this.config.sarvamBulbulTtsModel || 'bulbul:v3';
  }

  private providerFor(name: VoiceSttProviderName): SpeechToTextProvider {
    return name === 'sravaani' ? this.sravaani : this.sarvamStt;
  }

  private ttsProviderFor(name: VoiceTtsProviderName): TextToSpeechProvider {
    return name === 'dhvaani' ? this.dhvaaniTts : this.sarvamTts;
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

  private toTtsResponse(
    result: ProviderSynthesis,
    provider: VoiceTtsProviderName,
    primaryProvider: VoiceTtsProviderName,
    fallbackUsed: boolean,
    fallbackReason?: string,
  ): TTSResponse {
    return {
      ...result,
      provider,
      primaryProvider,
      fallbackUsed,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  }

  private ttsFailureCategory(error: unknown): string {
    return error instanceof TextToSpeechProviderError ? error.category : 'SERVICE_UNAVAILABLE';
  }

  private toPublicError(error: unknown): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: 'Voice service is currently unavailable.',
      category: this.failureCategory(error),
    });
  }

  private toTtsPublicError(error: unknown): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: 'Voice service is currently unavailable.',
      category: this.ttsFailureCategory(error),
    });
  }
}
