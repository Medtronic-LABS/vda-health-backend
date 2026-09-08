import { TTSRequest, VoiceTtsProviderName } from '../../ai/interfaces/tts-provider.interface';

export interface ProviderSynthesis {
  audioBuffer: Buffer;
  mimeType: string;
  model: string;
}

export type TextToSpeechFailureCategory =
  | 'NOT_CONFIGURED'
  | 'SERVICE_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'MODEL_UNAVAILABLE'
  | 'REFERENCE_UNAVAILABLE'
  | 'MODEL_INFERENCE_FAILED'
  | 'INVALID_TEXT';

export interface TextToSpeechProvider {
  readonly name: VoiceTtsProviderName;
  synthesize(input: TTSRequest): Promise<ProviderSynthesis>;
}

export class TextToSpeechProviderError extends Error {
  constructor(
    public readonly category: TextToSpeechFailureCategory,
    message: string,
  ) {
    super(message);
    this.name = 'TextToSpeechProviderError';
  }
}
