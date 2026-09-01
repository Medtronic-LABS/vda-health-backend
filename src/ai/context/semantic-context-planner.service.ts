import { Injectable } from '@nestjs/common';
import { HealthRecordCategory } from '../../abdm/interfaces/health-record-service.interface';
import { IntentType } from '../intents/intent.types';

export interface SemanticContextPlanInput {
  intent: IntentType;
  requestedCategories?: string[];
  knowledgeRequired?: boolean;
  responseRequirements?: string[];
}

export interface SemanticContextPlan {
  categories: HealthRecordCategory[];
  knowledgeRequired: boolean;
  responseRequirements: string[];
}

/**
 * Validates the model's semantic requirements before protected record access.
 * It never examines the patient's wording, so it cannot become a question map.
 */
@Injectable()
export class SemanticContextPlannerService {
  private static readonly permitted = new Set(Object.values(HealthRecordCategory));
  private static readonly defaults: Record<IntentType, HealthRecordCategory[]> = {
    [IntentType.ADHERENCE_QUERY]: [HealthRecordCategory.MEDICATION],
    [IntentType.MEDICATION_QUERY]: [HealthRecordCategory.MEDICATION],
    [IntentType.PRESCRIPTION_QUERY]: [HealthRecordCategory.PRESCRIPTION],
    [IntentType.LAB_RESULT_QUERY]: [HealthRecordCategory.LAB_REPORT, HealthRecordCategory.INVESTIGATION],
    [IntentType.DIAGNOSIS_QUERY]: [HealthRecordCategory.DIAGNOSIS],
    [IntentType.ALLERGY_QUERY]: [HealthRecordCategory.ALLERGY],
    [IntentType.GENERAL_HEALTH_QUERY]: [],
    [IntentType.GOVERNMENT_SCHEME_QUERY]: [],
    [IntentType.FACILITY_QUERY]: [],
    [IntentType.TELECONSULTATION_QUERY]: [],
    [IntentType.REFERRAL_QUERY]: [],
    [IntentType.GREETING]: [],
    [IntentType.CLARIFICATION]: [],
    [IntentType.UNKNOWN]: [],
  };

  plan(input: SemanticContextPlanInput): SemanticContextPlan {
    const supplied = (input.requestedCategories || [])
      .filter((value): value is HealthRecordCategory => SemanticContextPlannerService.permitted.has(value as HealthRecordCategory));
    // A short explicit semantic list takes precedence. Otherwise only the
    // intent's minimum data set is used; never fetch the whole record.
    const categories = [...new Set(supplied.length ? supplied : SemanticContextPlannerService.defaults[input.intent])].slice(0, 4);
    const responseRequirements = (input.responseRequirements || [])
      .filter((item) => ['GROUNDED_GUIDANCE', 'ALL_RECORD_ITEMS', 'VALUE_AND_UNCERTAINTY', 'CARE_PLAN_ITEMS', 'PRESCRIPTION_DOCUMENT_CONTEXT'].includes(item))
      .slice(0, 3);
    return {
      categories,
      knowledgeRequired: input.knowledgeRequired === true || input.intent === IntentType.GENERAL_HEALTH_QUERY || input.intent === IntentType.GOVERNMENT_SCHEME_QUERY,
      responseRequirements,
    };
  }
}
