/* eslint-disable no-misleading-character-class */
import { Injectable } from '@nestjs/common';
import {
  IPiiProtectionService,
  PiiDetectionResult,
} from '../interfaces/pii-protection-service.interface';

/**
 * DevelopmentPiiProtectionService
 *
 * A prototype deterministic PII detection service utilizing regular expressions.
 *
 * LIMITATION NOTICE:
 * This is a deterministic regex-based detector. Regex patterns cannot perfectly identify all
 * forms of PII. PII not being detected does NOT guarantee that the input is free of PII.
 * This implementation is intended for prototype and development verification. Swapping out
 * this implementation for a production PII service must be supported without changing TurnsController.
 */
@Injectable()
export class DevelopmentPiiProtectionService implements IPiiProtectionService {
  // Configuration of regex patterns for various PII categories
  private readonly piiPatterns: {
    category: string;
    regex: RegExp;
    replacement: string;
  }[] = [
    {
      category: 'abha_number',
      regex: /\b\d{2}-\d{4}-\d{4}-\d{4}\b/g,
      replacement: '[ABHA_NUMBER_REDACTED]',
    },
    {
      category: 'abha_address',
      regex: /\b[a-zA-Z0-9.-]+@(sbx|abdm)\b/gi,
      replacement: '[ABHA_ADDRESS_REDACTED]',
    },
    {
      category: 'aadhaar',
      regex: /\b\d{4}\s\d{4}\s\d{4}\b|\b\d{12}\b/g,
      replacement: '[AADHAAR_REDACTED]',
    },
    {
      category: 'pan',
      regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/gi,
      replacement: '[PAN_REDACTED]',
    },
    {
      category: 'phone',
      regex: /(?:\+91[-\s]?)?\b[6-9]\d{9}\b|\+91[6-9]\d{9}\b/g,
      replacement: '[PHONE_REDACTED]',
    },
    {
      category: 'email',
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      replacement: '[EMAIL_REDACTED]',
    },
    // Names (introductory English / Hindi / Hinglish phrases)
    {
      category: 'name',
      regex:
        /\b(?:[Mm]y [Nn]ame [Ii]s|[Ii] [Aa]m|[Mm]yself|[Cc]all [Mm]e|[Ii]'m)\s+([A-Z\u0900-\u097F][a-z\u0900-\u097F]+(?:\s+[A-Z\u0900-\u097F][a-z\u0900-\u097F]+)?)\b/g,
      replacement: '[NAME_REDACTED]',
    },
    {
      category: 'name_hindi',
      regex:
        /(?:मेरा नाम|mera naam)\s+([a-zA-Z\u0900-\u097F]+)(?:\s+(?:hoon|hu|है|hai|हूँ))?|(?:main|mein|मैं)\s+([a-zA-Z\u0900-\u097F]+)\s+(?:hoon|hu|हूँ)/gi,
      replacement: '[NAME_REDACTED]',
    },
    // Addresses
    {
      category: 'address',
      regex:
        /\b(?:resident of|living in|lives at|lives in)\s+([A-Za-z\s,.-]{3,30})\b/gi,
      replacement: '[ADDRESS_REDACTED]',
    },
    {
      category: 'address_hindi',
      regex:
        /([a-zA-Z\u0900-\u097F\s,.-]{3,30})\s*(?:ka nivasi|ka niwasi|ka resident|mein rehta|mein rehti|me rehta|me rehti|का निवासी|में रहता|में रहती)/gi,
      replacement: '[ADDRESS_REDACTED]',
    },
    // Generic Reference/Account IDs
    {
      category: 'reference_id',
      regex: /\b(?:REF|ACC|ID|PAT)-\d{4,10}\b/gi,
      replacement: '[REF_ID_REDACTED]',
    },
  ];

  async sanitizeText(
    text: string,
    localeHint?: string,
  ): Promise<PiiDetectionResult> {
    await Promise.resolve();
    if (!text) {
      return {
        sanitizedText: '',
        detectedPiiCategories: [],
        piiDetected: false,
        redactionMetadata: {},
        status: 'SUCCESS',
        language: localeHint || 'en',
      };
    }

    // Determine language based on content
    let language = 'en';
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    if (hasDevanagari) {
      language = 'hi';
    } else {
      // Check Hinglish keywords
      const hinglishKeywords =
        /\b(seene|mein|hai|hoon|rehta|rehti|dard|ka|naam|bahut|tez|dikkat|lakshan|khoon|hu)\b/i;
      if (hinglishKeywords.test(text)) {
        language = 'hi-Latn'; // Hinglish
      } else if (localeHint) {
        language = localeHint;
      }
    }

    let sanitized = text;
    const detectedPiiCategories: string[] = [];
    const redactionMetadata: Record<string, any> = {};

    // Apply regex detection
    for (const pattern of this.piiPatterns) {
      // Find all matches before replacing
      const matches = [...sanitized.matchAll(pattern.regex)];
      if (matches.length > 0) {
        detectedPiiCategories.push(pattern.category);
        redactionMetadata[pattern.category] = matches.map((m) => m[0]);

        // Perform replacement
        if (
          pattern.category === 'name' ||
          pattern.category === 'name_hindi' ||
          pattern.category === 'address' ||
          pattern.category === 'address_hindi'
        ) {
          sanitized = sanitized.replace(
            pattern.regex,
            (
              match: string,
              p1: string | number | undefined,
              p2: string | number | undefined,
            ) => {
              const captured = p1 || p2;
              if (typeof captured === 'string' && captured) {
                return match.replace(captured, pattern.replacement);
              }
              return pattern.replacement;
            },
          );
        } else {
          sanitized = sanitized.replace(pattern.regex, pattern.replacement);
        }
      }
    }

    const piiDetected = detectedPiiCategories.length > 0;

    return {
      sanitizedText: sanitized,
      detectedPiiCategories: [...new Set(detectedPiiCategories)],
      piiDetected,
      redactionMetadata,
      status: 'SUCCESS',
      language,
    };
  }
}
