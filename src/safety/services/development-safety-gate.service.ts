import { Injectable } from '@nestjs/common';
import { ISafetyGate, SafetyResult } from '../interfaces/safety-gate.interface';
import {
  asksToStopAllMedicines,
  emergencyKind,
  emergencyMessage,
  medicineChangeMessage,
  SELF_HARM_MESSAGE,
  STOP_ALL_MEDICINES_MESSAGE,
} from '../standard-messages';

@Injectable()
export class DevelopmentSafetyGate implements ISafetyGate {
  private readonly emergencyPatterns = {
    en: /\b(?:severe chest pain|difficulty breathing|unconscious|severe bleeding|stroke indicators|stroke)\b/i,
    hi: /(?:(?:सीने|छाती|chest)\s+(?:में|me|mein)\s+(?:[a-zA-Z\u0900-\u097F\s]{0,20})(?:दर्द|pain|dard)|सांस\s+(?:लेने\s+में\s+(?:बहुत\s+)?(?:दिक्कत|तकलीफ)|फूल)|बेहोश|बहुत\s+ज्यादा\s+खून\s+बहना|स्ट्रोक\s+के\s+संकेत|स्ट्रोक)/,
    hiLatn:
      /\b(?:seene mein bahut tez dard|chest me(?:in)?\s+(?:[a-zA-Z\s]{0,20})(?:pain|dard)|saans lene mein bahut dikkat|behosh|bahut zyada khoon beh raha|stroke ke lakshan|stroke)\b/i,
  };

  private readonly additionalEmergencyPatterns = [
    /\b(?:can(?:not| not|'t) breathe|unable to breathe|not breathing|struggling to breathe|hard to breathe|trouble breathing|short(?:ness)? of breath|gasping for air|severe breathlessness|breathing very hard|chest (?:pressure|tightness)|crushing chest|chest pain.{0,50}(?:left arm|arm|breath|breathing)|(?:left arm|arm).{0,50}chest pain|heavy bleeding|bleeding heavily|blood (?:will not|won't) stop|(?:fainted|passed out).{0,30}(?:now|today|not waking|unresponsive)|unresponsive|not waking up|bleeding (?:won't|will not) stop|face (?:is )?droop(?:ing)?|speech (?:is )?slurred|sudden (?:one.sided )?(?:weakness|paralysis)|slurred speech|poison(?:ed|ing)|swallowed poison|overdos(?:e|ed)|took too many (?:pills|tablets))\b/i,
    /(?:साँस|सांस|श्वास).{0,25}(?:नहीं|मुश्किल|दिक्कत|रुक|अटक)|(?:दम घुट|सांस बंद)|(?:सीने|छाती).{0,35}(?:दबाव|जकड़न|तेज दर्द|भयंकर दर्द)|(?:बाएं हाथ|बायें हाथ).{0,30}(?:दर्द|सीने)|(?:बहुत|तेज|ज्यादा).{0,15}(?:खून|रक्त).{0,15}(?:बह|निकल)|(?:लकवा|चेहरा टेढ़ा|बोली लड़खड़ा|एक तरफ कमजोरी|ज़हर|जहर|विष|ओवरडोज|ज्यादा गोलियां|ज्यादा दवाई|बेहोश|मूर्छित)/,
    /\b(?:saans|sans|saanse?|saas).{0,30}(?:nahi|nahin|ruk|atak|mushkil|dikkat|ghut)|(?:dam ghut|saans band|sans band)|(?:seene|sine|chhati|chati|chest).{0,35}(?:dabav|pressure|tight|tez dard|bahut dard)|(?:seene|sine|chhati)\s+mein?\s+dard.{0,30}(?:saans|sans)|(?:bahut|bohot|zyada|jada|tez).{0,20}(?:khoon|khun).{0,20}(?:beh|nikal)|(?:lakwa|chehra tedha|boli ladkhad|zeher|zahar|poison|overdose|zyada goli|behosh)\b/i,
  ];

  private normalizeForSafety(text: string): string {
    return text
      .normalize('NFKC')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // self-harm patterns mapping
  private readonly selfHarmPatterns = {
    en: /\b(?:suicide|kill myself|end my life|harm myself|cut my wrists|about to hurt myself|took pills to end my life)\b/i,
    hi: /(?:आत्महत्या|खुद को मारना|जीवन समाप्त करना|खुद को नुकसान पहुंचाना)/,
    hiLatn:
      /\b(?:suicide|khud ko marna|jaan de dunga|jaan de dungi|apni jaan lena|end my life|harm myself)\b/i,
  };

  // unsafe medication action patterns mapping
  private readonly medicationPatterns = {
    en: /\b(?:increase|decrease|stop|start|change|adjust)\s+(?:(?:\w+)\s+){0,2}(?:dose|dosage|medication|medicine|pill)\b|\b(?:self-medicate|taking double|double the dose)\b/i,
    hi: /(?:दवा (?:बढ़ाना|घटाना|बंद करना|बदलना|सुरू करना)|डबल खुराक|दवा बढ़ाएं|दवा घटाएं)/,
    hiLatn:
      /\b(?:dose|dawa|medicine|dosage|medication)\s+(?:increase|decrease|stop|start|change|adjust|double|kam|zyada|badhana|ghatana|band karna|badalna|double karna)\b|\b(?:self-medicate)\b/i,
  };

  async evaluateSafety(
    text: string,
    correlationId: string,
    language?: string,
  ): Promise<SafetyResult> {
    await Promise.resolve();
    let inputLang = language || 'en';
    const normalizedText = this.normalizeForSafety(text || '');

    // Override language context based on specific safety pattern matches
    const hiEmergencyMatch =
      this.emergencyPatterns.hi.test(normalizedText) ||
      this.additionalEmergencyPatterns[1].test(normalizedText);
    const hiLatnEmergencyMatch =
      this.emergencyPatterns.hiLatn.test(normalizedText) ||
      this.additionalEmergencyPatterns[2].test(normalizedText);

    // Replies follow the profile language whatever script the question uses;
    // Hinglish is answered in Devanagari Hindi. Script is only a fallback.
    if (language) {
      inputLang = language.startsWith('hi') ? 'hi' : 'en';
    } else {
      // Hinglish patterns also hold English words ("suicide"), so they count
      // only when no English pattern matches.
      const englishMatch =
        this.emergencyPatterns.en.test(normalizedText) ||
        this.additionalEmergencyPatterns[0].test(normalizedText) ||
        this.selfHarmPatterns.en.test(normalizedText) ||
        this.medicationPatterns.en.test(normalizedText);
      const hinglishMatch =
        hiLatnEmergencyMatch ||
        this.selfHarmPatterns.hiLatn.test(normalizedText) ||
        this.medicationPatterns.hiLatn.test(normalizedText);
      if (
        hiEmergencyMatch ||
        this.selfHarmPatterns.hi.test(normalizedText) ||
        this.medicationPatterns.hi.test(normalizedText) ||
        (hinglishMatch && !englishMatch)
      ) {
        inputLang = 'hi';
      }
    }

    // 1. INVALID_INPUT Rule Check (Highest Priority)
    if (!text || normalizedText === '' || normalizedText.length < 2) {
      return {
        status: 'INVALID_INPUT',
        ruleId: 'INVALID_INPUT_01',
        ruleVersion: '1.0',
        severity: 'LOW',
        action: 'REJECT',
        patientSafeMessage: 'Invalid or empty input text provided.',
        correlationId,
        language: inputLang,
      };
    }

    // Check for repetitive letters / obvious nonsense
    if (/^([a-zA-Z])\1{5,}$/.test(normalizedText)) {
      return {
        status: 'INVALID_INPUT',
        ruleId: 'INVALID_INPUT_01',
        ruleVersion: '1.0',
        severity: 'LOW',
        action: 'REJECT',
        patientSafeMessage: 'Nonsensical or repetitive text input rejected.',
        correlationId,
        language: inputLang,
      };
    }

    // 2. EMERGENCY Rule Check
    if (
      this.additionalEmergencyPatterns.some((pattern) =>
        pattern.test(normalizedText),
      ) ||
      this.emergencyPatterns.en.test(normalizedText) ||
      this.emergencyPatterns.hi.test(normalizedText) ||
      this.emergencyPatterns.hiLatn.test(normalizedText) ||
      emergencyKind(normalizedText) !== null
    ) {
      const patientSafeMessage = emergencyMessage(
        normalizedText,
        inputLang === 'hi',
      );

      return {
        status: 'ESCALATION_REQUIRED',
        ruleId: 'EMERGENCY_01',
        ruleVersion: '1.0',
        severity: 'HIGH',
        action: 'ESCALATE',
        patientSafeMessage,
        correlationId,
        language: inputLang,
      };
    }

    // 3. SELF_HARM Rule Check
    if (
      this.selfHarmPatterns.en.test(normalizedText) ||
      this.selfHarmPatterns.hi.test(normalizedText) ||
      this.selfHarmPatterns.hiLatn.test(normalizedText)
    ) {
      const patientSafeMessage =
        inputLang === 'hi' ? SELF_HARM_MESSAGE.hi : SELF_HARM_MESSAGE.en;

      return {
        status: 'ESCALATION_REQUIRED',
        ruleId: 'SELF_HARM_01',
        ruleVersion: '1.0',
        severity: 'HIGH',
        action: 'ESCALATE',
        patientSafeMessage,
        correlationId,
        language: inputLang,
      };
    }

    // 4. MEDICATION Rule Check
    if (
      this.medicationPatterns.en.test(normalizedText) ||
      this.medicationPatterns.hi.test(normalizedText) ||
      this.medicationPatterns.hiLatn.test(normalizedText)
    ) {
      const hindi = inputLang === 'hi';
      const stopAll = STOP_ALL_MEDICINES_MESSAGE[hindi ? 'hi' : 'en'];
      const patientSafeMessage = asksToStopAllMedicines(normalizedText)
        ? `${stopAll.summary} ${stopAll.reminders}`
        : medicineChangeMessage(normalizedText, hindi);

      return {
        status: 'WITHHOLD',
        ruleId: 'MEDICATION_01',
        ruleVersion: '1.0',
        severity: 'MEDIUM',
        action: 'WITHHOLD',
        patientSafeMessage,
        correlationId,
        language: inputLang,
      };
    }

    // 5. SAFE Rule Check (Default)
    return {
      status: 'SAFE',
      ruleId: null,
      ruleVersion: null,
      severity: null,
      action: null,
      patientSafeMessage: null,
      correlationId,
      language: inputLang,
    };
  }
}
