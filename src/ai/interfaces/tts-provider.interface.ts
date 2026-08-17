export interface TTSRequest {
  text: string;
  voiceId?: string;
  languageCode?: string;
}

export interface TTSResponse {
  audioBuffer: Buffer;
  mimeType: string;
}

export interface TTSProvider {
  synthesize(request: TTSRequest): Promise<TTSResponse>;
}
