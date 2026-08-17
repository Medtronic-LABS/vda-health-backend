export interface STTRequest {
  audioBuffer: Buffer;
  mimeType: string;
  languageHint?: string;
}

export interface STTResponse {
  transcript: string;
  confidence?: number;
}

export interface STTProvider {
  transcribe(request: STTRequest): Promise<STTResponse>;
}
