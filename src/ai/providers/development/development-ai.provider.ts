import { Injectable, Logger } from '@nestjs/common';
import {
  IAiProvider,
  AiGenerateOptions,
  AiGenerateResult,
  AiClassifyOptions,
  AiClassifyResult,
  ProviderHealth,
} from '../../interfaces/ai-provider.interface';

@Injectable()
export class DevelopmentAiProvider implements IAiProvider {
  private readonly logger = new Logger(DevelopmentAiProvider.name);

  async generate(
    prompt: string,
    options?: AiGenerateOptions,
  ): Promise<AiGenerateResult> {
    this.logger.log(
      `[DEV_AI] Generate requested promptLength=${prompt.length}`,
    );
    await Promise.resolve();

    const textLower = prompt.toLowerCase();
    const isHindi =
      textLower.includes('language: hi') || /[\u0900-\u097F]/.test(textLower);
    let responseText = 'Conversation processing is available in the prototype.';
    let jsonObj: Record<string, any> | undefined;

    if (isHindi) {
      if (
        textLower.includes('intent: medication_query') ||
        textLower.includes('दवाई')
      ) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'मुझे आपके रिकॉर्ड में वर्तमान दवाओं की जानकारी नहीं मिली।';
        } else {
          responseText =
            'आपकी वर्तमान दवाओं की सूची आपके रिकॉर्ड के अनुसार उपलब्ध है।';
        }
      } else if (
        textLower.includes('intent: lab_result_query') ||
        textLower.includes('रिपोर्ट')
      ) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'मुझे आपके रिकॉर्ड में हालिया लैब रिपोर्ट की जानकारी नहीं मिली।';
        } else {
          responseText = 'आपकी हालिया लैब रिपोर्ट की जानकारी उपलब्ध है।';
        }
      } else if (
        textLower.includes('intent: diagnosis_query') ||
        textLower.includes('बीमारी') ||
        textLower.includes('रोग') ||
        textLower.includes('निदान')
      ) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'मुझे आपके रिकॉर्ड में किसी बीमारी की जानकारी नहीं मिली।';
        } else {
          responseText = 'आपकी बीमारी और नैदानिक रिकॉर्ड की जानकारी उपलब्ध है।';
        }
      } else if (
        textLower.includes('intent: allergy_query') ||
        textLower.includes('एलर्जी') ||
        textLower.includes('एलर्गी') ||
        textLower.includes('ऐलर्जी')
      ) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'मुझे आपके रिकॉर्ड में किसी एलर्जी की जानकारी नहीं मिली।';
        } else {
          responseText =
            'आपकी एलर्जी की जानकारी आपके स्वास्थ्य रिकॉर्ड में उपलब्ध है।';
        }
      } else {
        responseText = 'प्रोटोटाइप में बातचीत की प्रक्रिया उपलब्ध है।';
      }
    } else {
      if (textLower.includes('intent: medication_query')) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'No active medication records were found in your available health records.';
        } else {
          responseText =
            'Your active medication records are available in your health context.';
        }
      } else if (textLower.includes('intent: lab_result_query')) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'No recent laboratory reports were found in your available health records.';
        } else {
          responseText =
            'Your lab report results are available in your health context.';
        }
      } else if (textLower.includes('intent: diagnosis_query')) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'No diagnosis records were found in your health context.';
        } else {
          responseText =
            'Your recorded diagnosis information is available in your health context.';
        }
      } else if (textLower.includes('intent: allergy_query')) {
        if (textLower.includes('no records') || textLower.includes('empty')) {
          responseText =
            'No allergy records were found in your health context.';
        } else {
          responseText =
            'Your allergy records are available in your health context.';
        }
      } else {
        responseText = 'Conversation processing is available in the prototype.';
      }
    }

    if (options?.responseFormat === 'json') {
      jsonObj = { response: responseText };
    }

    return {
      text: responseText,
      json: jsonObj,
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      provider: 'development',
      model: 'development-mock-v1',
    };
  }

  async classify(
    text: string,
    options?: AiClassifyOptions,
  ): Promise<AiClassifyResult> {
    this.logger.log(`[DEV_AI] Classify requested inputLength=${text.length}`);
    await Promise.resolve();

    const candidates = options?.candidateCategories || [];
    let selected = candidates[0] || 'UNKNOWN';

    const lower = text.toLowerCase();
    if (
      lower.includes('दवाई') ||
      lower.includes('medication') ||
      lower.includes('medicine')
    ) {
      selected = candidates.find((c) => c.includes('MEDICATION')) || selected;
    } else if (
      lower.includes('रिपोर्ट') ||
      lower.includes('lab') ||
      lower.includes('blood')
    ) {
      selected = candidates.find((c) => c.includes('LAB')) || selected;
    } else if (
      lower.includes('बीमारी') ||
      lower.includes('diagnosis') ||
      lower.includes('रोग')
    ) {
      selected = candidates.find((c) => c.includes('DIAGNOSIS')) || selected;
    } else if (
      lower.includes('एलर्जी') ||
      lower.includes('एलर्गी') ||
      lower.includes('allergy')
    ) {
      selected = candidates.find((c) => c.includes('ALLERGY')) || selected;
    } else if (
      lower.includes('नमस्ते') ||
      lower.includes('hello') ||
      lower.includes('hi')
    ) {
      selected = candidates.find((c) => c.includes('GREETING')) || selected;
    }

    return {
      category: selected,
      confidence: 0.95,
      explanation:
        'Deterministic rule-based classification in development AI provider',
      provider: 'development',
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    await Promise.resolve();
    return {
      status: 'AVAILABLE',
      details: 'Development AI provider is active in offline mode',
    };
  }
}
