export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationResponse {
  translatedText: string;
}

export interface TranslationProvider {
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}
