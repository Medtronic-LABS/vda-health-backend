import { VoiceSttProviderName } from '../../ai/interfaces/stt-provider.interface';

export interface SpeechToTextInput {
  audioBuffer: Buffer;
  mimeType: string;
  languageHint?: string;
}

export interface ProviderTranscription {
  transcript: string;
  confidence?: number;
  detectedLanguage?: string;
  model: string;
}

export type SpeechToTextFailureCategory =
  | 'NOT_CONFIGURED'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED_AUDIO'
  | 'AUDIO_DECODE_FAILED'
  | 'INVALID_AUDIO'
  | 'MODEL_INFERENCE_FAILED'
  | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'INFERENCE_FAILED';

/** Backend-only STT provider boundary. Patient clients never receive provider credentials. */
export interface SpeechToTextProvider {
  readonly name: VoiceSttProviderName;
  transcribe(input: SpeechToTextInput): Promise<ProviderTranscription>;
}

export class SpeechToTextProviderError extends Error {
  constructor(
    public readonly category: SpeechToTextFailureCategory,
    message: string,
  ) {
    super(message);
    this.name = 'SpeechToTextProviderError';
  }
}
