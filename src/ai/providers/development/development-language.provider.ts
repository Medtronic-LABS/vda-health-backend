import { Injectable, Logger } from '@nestjs/common';
import { ILanguageProvider } from '../../interfaces/language-provider.interface';
import { ProviderHealth } from '../../interfaces/ai-provider.interface';

@Injectable()
export class DevelopmentLanguageProvider implements ILanguageProvider {
  private readonly logger = new Logger(DevelopmentLanguageProvider.name);

  async detectLanguage(text: string): Promise<string> {
    await Promise.resolve();
    // Check for Devanagari Unicode range (U+0900 to U+097F)
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    const isHindi =
      hasDevanagari ||
      /\b(namaste|kya|kaun|dawai|meri|kab|hai|ho|main|dawa)\b/i.test(text);
    return isHindi ? 'hi' : 'en';
  }

  async translate(
    text: string,
    targetLang: string,
    sourceLang?: string,
  ): Promise<string> {
    this.logger.log(
      `[DEV_LANG] Translate requested from=${sourceLang || 'auto'} to=${targetLang}`,
    );
    await Promise.resolve();
    // Return original text in dev mode to avoid altering clinical semantics
    return text;
  }

  async normalizeIndianText(text: string): Promise<string> {
    await Promise.resolve();
    // Basic whitespace normalization
    return text.trim().replace(/\s+/g, ' ');
  }

  async healthCheck(): Promise<ProviderHealth> {
    await Promise.resolve();
    return {
      status: 'AVAILABLE',
      details: 'Development Language provider is active',
    };
  }
}
