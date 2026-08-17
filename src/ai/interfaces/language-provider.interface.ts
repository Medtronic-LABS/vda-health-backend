import { ProviderHealth } from './ai-provider.interface';

export interface ILanguageProvider {
  detectLanguage(text: string): Promise<string>;
  translate(
    text: string,
    targetLang: string,
    sourceLang?: string,
  ): Promise<string>;
  normalizeIndianText(text: string): Promise<string>;
  healthCheck(): Promise<ProviderHealth>;
}
