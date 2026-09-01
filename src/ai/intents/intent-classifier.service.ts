import { Injectable, Logger, Inject } from '@nestjs/common';
import { IIntentClassifier } from './intent-classifier.interface';
import { IntentType, IntentMetadata } from './intent.types';
import { IAiProvider } from '../interfaces/ai-provider.interface';
import { ILanguageProvider } from '../interfaces/language-provider.interface';
import { IntentToRecordCategoryMapper } from '../../abdm/mappers/intent-to-record-category.mapper';
import { HealthRecordCategory } from '../../abdm/interfaces/health-record-service.interface';
import { AuditService } from '../../audit/audit.service';
import { SemanticContextPlannerService } from '../context/semantic-context-planner.service';

@Injectable()
export class IntentClassifierService implements IIntentClassifier {
  private readonly logger = new Logger(IntentClassifierService.name);

  constructor(
    @Inject('IAiProvider') private readonly aiProvider: IAiProvider,
    @Inject('ILanguageProvider')
    private readonly languageProvider: ILanguageProvider,
    private readonly auditService: AuditService,
    private readonly contextPlanner: SemanticContextPlannerService,
  ) {}

  async classifyIntent(
    text: string,
    language?: string,
    correlationId?: string,
    conversationContext?: string,
  ): Promise<IntentMetadata> {
    const corrId = correlationId || 'unknown';

    // ─── Step 1: Detect language if not provided ──────────────────────────────
    const detectedLang =
      language || (await this.languageProvider.detectLanguage(text));

    // Normal VDA routing is always provider-classified. Deterministic rules
    // remain exclusively in SafetyGate, which runs before orchestration.
    this.logger.log(
      `[IntentClassifier] Stage 2 AI Classification invoked for text: "${text.substring(0, 50)}"`,
    );

    let aiCategory = IntentType.UNKNOWN;
    let confidence = 0.5;
    let requirements: IntentMetadata['requirements'];
    let semanticLanguage: 'hi' | 'en' | undefined;
    let knowledgeRequired: boolean | undefined;
    let responseRequirements: string[] | undefined;

    try {
      const candidates = Object.values(IntentType);
      const aiResult = await this.aiProvider.classify(text, {
        candidateCategories: candidates,
        correlationId: corrId,
        conversationContext,
      });

      if (Object.values(IntentType).includes(aiResult.category as IntentType)) {
        aiCategory = aiResult.category as IntentType;
        confidence = aiResult.confidence;
        requirements = aiResult.requirements;
        semanticLanguage = aiResult.language;
        knowledgeRequired = aiResult.requirements?.knowledgeRequired;
        responseRequirements = aiResult.requirements?.responseRequirements;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `AI intent classification failed; returning UNKNOWN: ${errMsg}`,
      );
    }

    const metadata = this.buildMetadata(
      aiCategory,
      confidence,
      semanticLanguage || detectedLang,
      'AI_MODEL',
    );
    metadata.requirements = requirements;
    const plan = this.contextPlanner.plan({
      intent: aiCategory,
      requestedCategories: aiResultRequirements(requirements),
      knowledgeRequired,
      responseRequirements,
    });
    metadata.requiredRecordCategories = plan.categories;
    metadata.requiresClinicalContext = plan.categories.length > 0;
    metadata.knowledgeRequired = plan.knowledgeRequired;
    metadata.responseRequirements = plan.responseRequirements;

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

function aiResultRequirements(value: IntentMetadata['requirements']): string[] | undefined {
  const candidate = value as (IntentMetadata['requirements'] & { recordCategories?: string[] }) | undefined;
  return candidate?.recordCategories;
}
