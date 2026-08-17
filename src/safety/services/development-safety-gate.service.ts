import { Injectable } from '@nestjs/common';
import { ISafetyGate, SafetyResult } from '../interfaces/safety-gate.interface';

@Injectable()
export class DevelopmentSafetyGate implements ISafetyGate {
  // emergency indicators mapping
  private readonly emergencyPatterns = {
    en: /\b(?:severe chest pain|difficulty breathing|unconscious|severe bleeding|stroke indicators|stroke)\b/i,
    hi: /(?:सीने में बहुत तेज दर्द|सांस लेने में बहुत दिक्कत|बेहोश|बहुत ज्यादा खून बहना|स्ट्रोक के संकेत|स्ट्रोक)/,
    hiLatn:
      /\b(?:seene mein bahut tez dard|saans lene mein bahut dikkat|behosh|bahut zyada khoon beh raha|stroke ke lakshan|stroke)\b/i,
  };

  // self-harm patterns mapping
  private readonly selfHarmPatterns = {
    en: /\b(?:suicide|kill myself|end my life|harm myself)\b/i,
    hi: /(?:आत्महत्या|खुद को मारना|जीवन समाप्त करना|खुद को नुकसान पहुंचाना)/,
    hiLatn:
      /\b(?:suicide|khud ko marna|jaan de dunga|jaan de dungi|apni jaan lena|end my life|harm myself)\b/i,
  };

  // unsafe medication action patterns mapping
  private readonly medicationPatterns = {
    en: /\b(?:increase|decrease|stop|start|change|adjust)\s+(?:dose|dosage|medication|medicine|pill)\b|\b(?:self-medicate|taking double|double the dose)\b/i,
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

    // Override language context based on specific safety pattern matches
    if (!language) {
      if (
        this.emergencyPatterns.hi.test(text) ||
        this.selfHarmPatterns.hi.test(text) ||
        this.medicationPatterns.hi.test(text)
      ) {
        inputLang = 'hi';
      } else if (
        this.emergencyPatterns.hiLatn.test(text) ||
        this.selfHarmPatterns.hiLatn.test(text) ||
        this.medicationPatterns.hiLatn.test(text)
      ) {
        inputLang = 'hi-Latn';
      }
    } else {
      if (
        (inputLang === 'en' || inputLang === 'hi-Latn') &&
        (this.emergencyPatterns.hi.test(text) ||
          this.selfHarmPatterns.hi.test(text) ||
          this.medicationPatterns.hi.test(text))
      ) {
        inputLang = 'hi';
      } else if (
        inputLang === 'en' &&
        (this.emergencyPatterns.hiLatn.test(text) ||
          this.selfHarmPatterns.hiLatn.test(text) ||
          this.medicationPatterns.hiLatn.test(text))
      ) {
        const matchesEn =
          this.emergencyPatterns.en.test(text) ||
          this.selfHarmPatterns.en.test(text) ||
          this.medicationPatterns.en.test(text);
        if (!matchesEn) {
          inputLang = 'hi-Latn';
        }
      }
    }

    // 1. INVALID_INPUT Rule Check (Highest Priority)
    if (!text || text.trim() === '' || text.length < 2) {
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
    if (/([a-zA-Z])\1{5,}/.test(text)) {
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
      this.emergencyPatterns.en.test(text) ||
      this.emergencyPatterns.hi.test(text) ||
      this.emergencyPatterns.hiLatn.test(text)
    ) {
      let patientSafeMessage =
        'If you are experiencing a medical emergency, please contact local emergency services or visit the nearest emergency room immediately.';
      if (inputLang === 'hi') {
        patientSafeMessage =
          'यदि आप एक चिकित्सा आपात स्थिति का अनुभव कर रहे हैं, तो कृपया तुरंत स्थानीय आपातकालीन सेवाओं से संपर्क करें या निकटतम आपातकालीन कक्ष में जाएं।';
      } else if (inputLang === 'hi-Latn') {
        patientSafeMessage =
          'Yadi aap medical emergency face kar rahe hain, toh please turant emergency services ko contact karein ya nearest emergency room jayein.';
      }

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
      this.selfHarmPatterns.en.test(text) ||
      this.selfHarmPatterns.hi.test(text) ||
      this.selfHarmPatterns.hiLatn.test(text)
    ) {
      let patientSafeMessage =
        'If you are having thoughts of self-harm or suicide, please reach out for help immediately. Contact a mental health professional or call a support hotline.';
      if (inputLang === 'hi') {
        patientSafeMessage =
          'यदि आप आत्म-नुकसान या आत्महत्या के विचार महसूस कर रहे हैं, तो कृपया तुरंत मदद लें। किसी मानसिक स्वास्थ्य पेशेवर से संपर्क करें।';
      } else if (inputLang === 'hi-Latn') {
        patientSafeMessage =
          'Yadi aap self-harm ya suicide ke thoughts face kar rahe hain, toh please immediately professional help ya mental health helpline se contact karein.';
      }

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
      this.medicationPatterns.en.test(text) ||
      this.medicationPatterns.hi.test(text) ||
      this.medicationPatterns.hiLatn.test(text)
    ) {
      let patientSafeMessage =
        'Unsafe medication request detected. We cannot advise on modifying dosage, stopping, or starting high-risk medications without direct clinician consultation.';
      if (inputLang === 'hi') {
        patientSafeMessage =
          'असुरक्षित दवा अनुरोध का पता चला है। हम चिकित्सक के परामर्श के बिना खुराक बदलने, दवा बंद करने या शुरू करने की सलाह नहीं दे सकते।';
      } else if (inputLang === 'hi-Latn') {
        patientSafeMessage =
          'Unsafe medication request detect hua hai. Hum doctor ke consult ke bina dosage change karne, dawa band karne ya start karne ki advice nahi de sakte.';
      }

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
