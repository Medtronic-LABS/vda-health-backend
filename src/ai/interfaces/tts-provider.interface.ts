export type VoiceTtsProviderName = 'dhvaani' | 'sarvam';

export interface TTSRequest {
  text: string;
  voiceId?: string;
  languageCode?: string;
}

export interface TTSResponse {
  audioBuffer: Buffer;
  mimeType: string;
  provider: VoiceTtsProviderName;
  model: string;
  primaryProvider: VoiceTtsProviderName;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export interface TTSProvider {
  synthesize(request: TTSRequest): Promise<TTSResponse>;
}
