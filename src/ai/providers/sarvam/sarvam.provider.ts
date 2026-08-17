import { Injectable, Logger } from '@nestjs/common';
import { ConfigurationService } from '../../../configuration/configuration.service';
import { ILanguageProvider } from '../../interfaces/language-provider.interface';
import { ProviderHealth } from '../../interfaces/ai-provider.interface';

@Injectable()
export class SarvamProvider implements ILanguageProvider {
  private readonly logger = new Logger(SarvamProvider.name);

  constructor(private readonly config: ConfigurationService) {}

  async detectLanguage(text: string): Promise<string> {
    if (!this.config.sarvamEnabled || !this.config.sarvamApiKey) {
      return this.fallbackDetectLanguage(text);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.config.sarvamTimeoutMs,
      );

      const res = await fetch('https://api.sarvam.ai/language-detection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': this.config.sarvamApiKey,
        },
        body: JSON.stringify({ input: text }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Sarvam API status ${res.status}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      return (
        (data['language_code'] as string) || this.fallbackDetectLanguage(text)
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Sarvam language detection failed, falling back to rule engine: ${errMsg}`,
      );
      return this.fallbackDetectLanguage(text);
    }
  }

  async translate(text: string, targetLanguage: string): Promise<string> {
    if (!this.config.sarvamEnabled || !this.config.sarvamApiKey) {
      return text;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.config.sarvamTimeoutMs,
      );

      const res = await fetch('https://api.sarvam.ai/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': this.config.sarvamApiKey,
        },
        body: JSON.stringify({
          input: text,
          target_language_code: targetLanguage,
          model: this.config.sarvamModel,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Sarvam Translation API status ${res.status}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      return (data['translated_text'] as string) || text;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Sarvam translation failed, returning raw text: ${errMsg}`,
      );
      return text;
    }
  }

  async normalizeIndianText(text: string): Promise<string> {
    await Promise.resolve();
    if (!text) return text;
    return text.replace(/\s+/g, ' ').trim();
  }

  async healthCheck(): Promise<ProviderHealth> {
    await Promise.resolve();
    if (!this.config.sarvamEnabled || !this.config.sarvamApiKey) {
      return {
        status: 'NOT_CONFIGURED',
        details: 'Sarvam API key is missing or disabled',
      };
    }
    return {
      status: 'AVAILABLE',
      details: `Sarvam model ${this.config.sarvamModel} is configured`,
    };
  }

  private fallbackDetectLanguage(text: string): string {
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    const isHindi =
      hasDevanagari ||
      /\b(namaste|kya|kaun|dawai|meri|kab|hai|ho|main|dawa)\b/i.test(text);
    return isHindi ? 'hi' : 'en';
  }
}
