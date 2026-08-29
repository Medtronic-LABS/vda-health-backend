import { Injectable, Logger, Inject } from '@nestjs/common';
import { IIntentClassifier } from './intent-classifier.interface';
import { IntentType, IntentMetadata } from './intent.types';
import { IAiProvider } from '../interfaces/ai-provider.interface';
import { ILanguageProvider } from '../interfaces/language-provider.interface';
import { IntentToRecordCategoryMapper } from '../../abdm/mappers/intent-to-record-category.mapper';
import { HealthRecordCategory } from '../../abdm/interfaces/health-record-service.interface';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class IntentClassifierService implements IIntentClassifier {
  private readonly logger = new Logger(IntentClassifierService.name);

  constructor(
    @Inject('IAiProvider') private readonly aiProvider: IAiProvider,
    @Inject('ILanguageProvider')
    private readonly languageProvider: ILanguageProvider,
    private readonly auditService: AuditService,
  ) {}

  async classifyIntent(
    text: string,
    language?: string,
    correlationId?: string,
  ): Promise<IntentMetadata> {
    const corrId = correlationId || 'unknown';

    // ─── Step 1: Detect language if not provided ──────────────────────────────
    const detectedLang =
      language || (await this.languageProvider.detectLanguage(text));

    // ─── Stage 1: Deterministic / Rule-based Classification ─────────────────
    const ruleResult = this.classifyByRules(text, detectedLang);
    if (ruleResult && ruleResult.confidence >= 0.85) {
      this.logger.log(
        `[IntentClassifier] Stage 1 Rule Match: intent=${ruleResult.intent} confidence=${ruleResult.confidence}`,
      );

      const metadata = this.buildMetadata(
        ruleResult.intent,
        ruleResult.confidence,
        detectedLang,
        'RULE_ENGINE',
      );

      // Audit Stage 1 classification
      await this.auditService.logEvent({
        tenantId: '00000000-0000-0000-0000-000000000000',
        subjectAbhaRef: 'system-intent-classification',
        actingPrincipal: 'intent-classifier-service',
        correlationId: corrId,
        action: 'ai_intent_classified',
        entityName: 'intent',
        entityId: ruleResult.intent,
        details: {
          intent: ruleResult.intent,
          confidence: ruleResult.confidence,
          classifiedBy: 'RULE_ENGINE',
          language: detectedLang,
        },
      });

      return metadata;
    }

    // ─── Stage 2: AI Provider (Gemini / Dev) Classification ─────────────────
    this.logger.log(
      `[IntentClassifier] Stage 2 AI Classification invoked for text: "${text.substring(0, 50)}"`,
    );

    let aiCategory = IntentType.UNKNOWN;
    let confidence = 0.5;

    try {
      const candidates = Object.values(IntentType);
      const aiResult = await this.aiProvider.classify(text, {
        candidateCategories: candidates,
        correlationId: corrId,
      });

      if (Object.values(IntentType).includes(aiResult.category as IntentType)) {
        aiCategory = aiResult.category as IntentType;
        confidence = aiResult.confidence;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Stage 2 AI Classification failed, falling back to rule engine or UNKNOWN: ${errMsg}`,
      );
      if (ruleResult) {
        aiCategory = ruleResult.intent;
        confidence = ruleResult.confidence;
      }
    }

    const metadata = this.buildMetadata(
      aiCategory,
      confidence,
      detectedLang,
      'AI_MODEL',
    );

    // Audit Stage 2 classification
    await this.auditService.logEvent({
      tenantId: '00000000-0000-0000-0000-000000000000',
      subjectAbhaRef: 'system-intent-classification',
      actingPrincipal: 'intent-classifier-service',
      correlationId: corrId,
      action: 'ai_intent_classified',
      entityName: 'intent',
      entityId: aiCategory,
      details: {
        intent: aiCategory,
        confidence,
        classifiedBy: 'AI_MODEL',
        language: detectedLang,
      },
    });

    return metadata;
  }

  // ---------------------------------------------------------------------------
  // Stage 1 Rule Engine
  // ---------------------------------------------------------------------------
  private classifyByRules(
    text: string,
    detectedLang: string,
  ): { intent: IntentType; confidence: number } | null {
    const lower = text.trim().toLowerCase();

    // 1. GREETING
    if (
      /^(नमस्ते|नमस्कार|हेलो|हाय|सुप्रभात|शुभ संध्या|hello|hi|hey|good morning|good evening|greetings)[.?]?$/i.test(
        lower,
      ) ||
      (detectedLang === 'hi' && /^(नमस्ते|नमस्कार)$/i.test(lower))
    ) {
      return { intent: IntentType.GREETING, confidence: 0.98 };
    }

    // 2. ADHERENCE_QUERY: a presentation-facing care-navigation intent. It
    // deliberately precedes medication lookup so only adherence questions are
    // routed to AdherenceAgent; medication facts still come from ClinicalContext.
    if (
      /दवाई.*(भूल|नियमित|समय)|दवा.*(भूल|नियमित|समय)|दवाई लेना भूल|medicines?.*(forget|regular|on time)|forget.*medicin|adherence|missed dose|treatment.*regular/i.test(
        lower,
      )
    ) {
      return { intent: IntentType.ADHERENCE_QUERY, confidence: 0.95 };
    }

    // A brief explicit answer is resolved only by the medication state machine
    // against a pending adherence confirmation in the current session. Routing
    // it here prevents a needless provider call; it never infers MISSED.
    if (/^(?:हाँ|हां|जी हाँ|नहीं|ना|ha|haan|han|yes|no|nahi|nahin)$/i.test(lower)) {
      return { intent: IntentType.ADHERENCE_QUERY, confidence: 0.95 };
    }

    // 3. MEDICATION_QUERY vs PRESCRIPTION_QUERY
    const hasMedKeyword =
      /दवाई|दवा|दवाइयां|दवाइया|दवाइयाँ|दवाइयों|दवाइयो|medication|medicine|medicines|tablet|tablets|dose|dosage|dawa/i.test(
        lower,
      );
    const hasPrescriptionKeyword =
      /पर्ची|प्रिस्क्रिप्शन|prescription|prescribed|डॉक्टर ने लिखी|लिखे हैं|लिखे हैं|konse test likhe|kaun se test|कौन से टेस्ट|इनमें से.*dengue|dengue.*test|ye test|wo test|इस दवाई|wo dawiya|wo dawai|wo dawa|likha hai|likhe hain/i.test(
        lower,
      );

    if (hasPrescriptionKeyword) {
      return { intent: IntentType.PRESCRIPTION_QUERY, confidence: 0.95 };
    }
    if (hasMedKeyword) {
      return { intent: IntentType.MEDICATION_QUERY, confidence: 0.95 };
    }

    // 4. LAB_RESULT_QUERY
    if (
      /रिपोर्ट|लैब|टेस्ट|जांच|शुगर|रक्त|ब्लड|lab|report|result|test|glucose|hba1c|ecg|cbc|bp|blood\s*pressure|pressure|बीपी|प्रेशर|ग्लूकोज|ग्लूकोस|चीनी/i.test(
        lower,
      )
    ) {
      return { intent: IntentType.LAB_RESULT_QUERY, confidence: 0.95 };
    }

    // 5. DIAGNOSIS_QUERY
    if (
      /बीमारी|बीमारियाँ|बीमारियां|रोग|निदान|डायग्नोसिस|समस्या|diagnosis|condition|disease|illness|hypertension|diabetes/i.test(
        lower,
      )
    ) {
      return { intent: IntentType.DIAGNOSIS_QUERY, confidence: 0.92 };
    }

    // 6. ALLERGY_QUERY
    if (
      /एलर्जी|एलर्गी|ऐलर्जी|allergen|allergy|allergies|reaction/i.test(lower)
    ) {
      return { intent: IntentType.ALLERGY_QUERY, confidence: 0.95 };
    }

    // 7. FACILITY_QUERY
    // A facility request may also name a scheme such as PM-JAY. In that case,
    // route by the requested service rather than the scheme keyword.
    if (
      /अस्पताल|क्लिनिक|अस्पतालों|phc|chc|facility|facilities|hospital|hospitals|clinic|पास में|नजदीक|near me|nearby|gurugram|gurgaon|गुरुग्राम|गुड़गांव|kangra|कांगड़ा|कांगरा|west\s+delhi|पश्चिम\s+दिल्ली|इनमें से.*(सरकारी|निजी)|और.*(himcare|ayushman|pm-?jay).*वाला/i.test(lower)
    ) {
      return { intent: IntentType.FACILITY_QUERY, confidence: 0.95 };
    }

    // 8. GOVERNMENT_SCHEME_QUERY
    if (
      /योजना|आयुष्मान|पीएमजेएवाई|pmjay|pm-jay|ayushman|himcare|हिमकेयर|scheme|insurance|card|बीमा/i.test(
        lower,
      )
    ) {
      return { intent: IntentType.GOVERNMENT_SCHEME_QUERY, confidence: 0.95 };
    }

    // 9. TELECONSULTATION_QUERY
    if (
      /ऑनलाइन.*डॉक्टर|डॉक्टर.*ऑनलाइन|डॉक्टर\s*से\s*बात|टेली.?कंसल्ट|tele.?consult|online doctor|doctor.*online|talk to (a )?doctor|i want to talk to (a )?doctor|video consultation/i.test(
        lower,
      )
    ) {
      return { intent: IntentType.TELECONSULTATION_QUERY, confidence: 0.95 };
    }

    // 10. REFERRAL_QUERY
    if (/रेफर|रेफरल|refer|referral|pathway/i.test(lower)) {
      return { intent: IntentType.REFERRAL_QUERY, confidence: 0.95 };
    }

    // 11. GENERAL_HEALTH_QUERY
    if (/स्वास्थ्य|सेहत|health|fitness|wellness|general health/i.test(lower)) {
      return { intent: IntentType.GENERAL_HEALTH_QUERY, confidence: 0.88 };
    }

    // 12. CLARIFICATION
    if (
      /क्या मतलब|फिर से बताएं|समझ नहीं आया|repeat|explain|clarify|what do you mean/i.test(
        lower,
      )
    ) {
      return { intent: IntentType.CLARIFICATION, confidence: 0.9 };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Intent Metadata Builder
  // ---------------------------------------------------------------------------
  private buildMetadata(
    intent: IntentType,
    confidence: number,
    language: string,
    classifiedBy: 'RULE_ENGINE' | 'AI_MODEL',
  ): IntentMetadata {
    const categories: HealthRecordCategory[] =
      IntentToRecordCategoryMapper.getCategories(intent);
    const requiresClinicalContext = categories.length > 0;

    let safetySensitivity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (
      intent === IntentType.ADHERENCE_QUERY ||
      intent === IntentType.MEDICATION_QUERY ||
      intent === IntentType.PRESCRIPTION_QUERY ||
      intent === IntentType.DIAGNOSIS_QUERY
    ) {
      safetySensitivity = 'HIGH';
    } else if (
      intent === IntentType.LAB_RESULT_QUERY ||
      intent === IntentType.ALLERGY_QUERY
    ) {
      safetySensitivity = 'MEDIUM';
    }

    return {
      intent,
      confidence,
      language,
      requiresClinicalContext,
      requiredRecordCategories: categories,
      safetySensitivity,
      classifiedBy,
    };
  }
}
