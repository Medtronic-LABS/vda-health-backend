export interface STTRequest {
  audioBuffer: Buffer;
  mimeType: string;
  languageHint?: string;
  requestedProvider?: VoiceSttProviderName;
}

export type VoiceSttProviderName = 'sravaani' | 'sarvam';

export interface STTResponse {
  transcript: string;
  confidence?: number;
  detectedLanguage?: string;
  /** Provider which actually produced the transcript. */
  provider: VoiceSttProviderName;
  primaryProvider: VoiceSttProviderName;
  model?: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export interface STTProvider {
  transcribe(request: STTRequest): Promise<STTResponse>;
}
