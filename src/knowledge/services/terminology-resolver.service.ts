import { Injectable } from '@nestjs/common';
import { SchemeInformationType } from '../../ai/intents/intent.types';

export type CanonicalSchemeCode = 'PM-JAY' | 'HIMCARE' | 'PMBJP';

/**
 * Stage 1 Deterministic Terminology & Canonical Scheme Resolver.
 * Maps common patient abbreviations, transliterations, and regional synonyms
 * to canonical scheme codes and cleans bureaucratic acronyms from output text.
 */
@Injectable()
export class TerminologyResolverService {
  resolveCanonicalScheme(text: string): CanonicalSchemeCode | undefined {
    if (!text) return undefined;
    if (
      /\b(?:him\s*care|himcare|himachali\s*health\s*card)\b|हिम\s*केयर|हिमकेयर/iu.test(
        text,
      )
    ) {
      return 'HIMCARE';
    }
    if (
      /\b(?:pmbjp|jan\s*aushadhi|janaushadhi|pradhan\s*mantri\s*bhartiya\s*janaushadhi)\b|जन\s*औषधि|पीएमबीजेपी/iu.test(
        text,
      )
    ) {
      return 'PMBJP';
    }
    if (
      /\b(?:ab[\s-]*pm[\s-]*jay|abpmj(?:ay)?|pm[\s-]*jay|ayushman(?:\s+bharat)?|aayushman(?:\s+bharat)?|jan\s*arogya|pradhan\s*mantri\s*jan\s*arogya|golden\s*card|5\s*lakh\s*(?:wala\s*)?(?:card|yojana|scheme|ilaj))\b|आयुष्मान(?:\s*भारत)?|पीएम[\s-]*जेएवाई|पीएमजेएवाई|जन\s*आरोग्य|गोल्डन\s*कार्ड|एबीपीएमजे/iu.test(
        text,
      )
    ) {
      return 'PM-JAY';
    }
    return undefined;
  }

  /**
   * Normalizes an arbitrary scheme string (e.g. extracted by LLM as "Ayushman Bharat" or "ABPMJ")
   * into the canonical DB lookup token ("PM-JAY", "HIMCARE", "PMBJP").
   */
  normalizeSchemeLookupQuery(
    schemeName?: string | null,
    inputText?: string,
  ): string | undefined {
    const fromScheme = schemeName
      ? this.resolveCanonicalScheme(schemeName)
      : undefined;
    if (fromScheme) return fromScheme;
    const fromInput = inputText
      ? this.resolveCanonicalScheme(inputText)
      : undefined;
    if (fromInput) return fromInput;
    return schemeName || undefined;
  }

  /**
   * Determines whether a patient message is directly asking about a known government scheme
   * (without being a clinical dose/emergency question or a city-specific hospital search).
   */
  isDirectSchemeQuery(text: string): boolean {
    const canonical = this.resolveCanonicalScheme(text);
    if (!canonical) return false;
    const isClinicalOrEmergency =
      /\b(?:chest\s*pain|breathing|unconscious|suicide|self[\s-]*harm|missed\s*dose|double\s*dose|stop\s*(?:my\s*)?medicine|change\s*(?:my\s*)?dose)\b|सीने\s*में\s*दर्द|सांस|बेहोश|आत्महत्या|दवा\s*बंद|खुराक\s*बदल/iu.test(
        text,
      );
    if (isClinicalOrEmergency) return false;
    const isExplicitFacilityLocationSearch =
      /\b(?:hospitals?\s+in|hospitals?\s+near|find\s+(?:a\s+)?hospital|nearest\s+hospital|kaun\s+sa\s+hospital)\b|में\s+अस्पताल|नज़दीकी\s+अस्पताल|पास\s+का\s+अस्पताल/iu.test(
        text,
      );
    if (isExplicitFacilityLocationSearch) return false;
    return true;
  }

  /**
   * Resolves the semantic scheme information type deterministically when a known scheme
   * or explicit scheme aspect is present, preventing false SCHEME_UNKNOWN refusals.
   */
  resolveSchemeInformationType(
    text: string,
    currentType?: SchemeInformationType,
    canonicalScheme?: CanonicalSchemeCode,
  ): SchemeInformationType | undefined {
    const scheme = canonicalScheme || this.resolveCanonicalScheme(text);

    if (
      /\b(?:which\s+schemes?|what\s+schemes?|available\s+schemes?|schemes?\s+in\s+my\s+state|kaun\s*si\s*yojana|konsi\s*yojna)\b|कौन[\s-]*कौन\s*सी\s*योजना|कौन\s*सी\s*योजनाएं|उपलब्ध\s*योजना/iu.test(
        text,
      ) &&
      !scheme
    ) {
      return 'SCHEME_AVAILABILITY';
    }
    if (
      /\b(?:documents?|kagaz|id\s*proof|identity\s*proof|papers?|what\s+to\s+bring)\b|दस्तावेज|दस्तावेज़|कागज|कागज़|प्रमाण\s*पत्र/iu.test(
        text,
      )
    ) {
      return 'SCHEME_DOCUMENTS';
    }
    if (
      /\b(?:apply|application|enrol+l?(?:ment)?|register|registration|card\s*(?:creation|ban\w*|kaise)|how\s+to\s+get\s+(?:a\s+)?card|kahan\s+banega)\b|कैसे\s*(?:अप्लाई|आवेदन|बनवाएं|बनवाएँ|बनेगा)|आवेदन|पंजीकरण|कार्ड\s*(?:बन|बनवा|कैसे)/iu.test(
        text,
      )
    ) {
      return 'SCHEME_APPLICATION';
    }
    if (
      /\b(?:every\s+hospital|all\s+hospitals?|any\s+hospital|har\s+hospital|sabhi\s+hospital|kisi\s+bhi\s+hospital)\b|हर\s+अस्पताल|सभी\s+अस्पताल|किसी\s+भी\s+अस्पताल/iu.test(
        text,
      )
    ) {
      return 'SCHEME_BENEFITS';
    }
    if (
      /\b(?:eligible|eligibility|who\s+can\s+get|am\s+i\s+eligible|qualify|patrata|kisko\s+milta|kaun\s+le\s+sakta)\b|पात्र|पात्रता|किसे\s*मिलता|कौन\s*पात्र/iu.test(
        text,
      )
    ) {
      return 'SCHEME_ELIGIBILITY';
    }
    if (
      /\b(?:benefits?|coverage|cover|limit|amount|5\s*lakh|free\s*treatment|cashless|operation|surgery|hospitali[sz](?:ation|ed)|fayde|labh|ilaj)\b|लाभ|फायदे|फ़ायदे|कवर|5\s*लाख|मुफ्त\s*इलाज|कैशलेस|ऑपरेशन|सर्जरी|भर्ती/iu.test(
        text,
      )
    ) {
      return currentType && currentType !== 'SCHEME_UNKNOWN'
        ? currentType
        : 'SCHEME_BENEFITS';
    }

    if (currentType && currentType !== 'SCHEME_UNKNOWN') {
      return currentType;
    }

    if (scheme) {
      return 'SCHEME_OVERVIEW';
    }

    return currentType;
  }

  /**
   * Replaces bureaucratic acronyms (like EHCP, PMAM, BIS) with simple patient-friendly
   * terms in both Hindi and English visual/spoken outputs.
   */
  sanitizeBureaucraticTerms(text: string, language?: string): string {
    if (!text) return text;
    const isHindi =
      Boolean(language?.startsWith('hi')) || /[\u0900-\u097f]/u.test(text);
    return text
      .replace(
        /\bEmpanelled\s+Health\s+Care\s+Providers?\s*\(\s*EHCPs?\s*\)/giu,
        isHindi ? 'सूचीबद्ध अस्पताल' : 'empanelled hospitals',
      )
      .replace(/\s*\(\s*EHCPs?\s*\)/giu, '')
      .replace(
        /\bEHCPs?\b/gu,
        isHindi ? 'सूचीबद्ध अस्पताल' : 'empanelled hospitals',
      )
      .replace(/\s*\(\s*BIS\s*\)/gu, '')
      .replace(
        /\bPMAMs?\b/gu,
        isHindi ? 'आयुष्मान मित्र' : 'Ayushman Mitra',
      )
      .replace(/\s+([,.!?।॥;:])/gu, '$1')
      .replace(/ {2,}/gu, ' ')
      .trim();
  }
}

