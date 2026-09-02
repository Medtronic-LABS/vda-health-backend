import { HealthRecordCategory } from '../../abdm/interfaces/health-record-service.interface';

/**
 * Semantic subject of a government-scheme question.  This is classified by the
 * AI provider and only constrains response generation; it never routes by a
 * scheme name or changes governed retrieval.
 */
export type SchemeInformationType =
  | 'SCHEME_OVERVIEW'
  | 'SCHEME_AVAILABILITY'
  | 'SCHEME_ELIGIBILITY'
  | 'SCHEME_DOCUMENTS'
  | 'SCHEME_APPLICATION'
  | 'SCHEME_BENEFITS'
  | 'SCHEME_FACILITY'
  | 'SCHEME_COMPARISON'
  | 'SCHEME_UNKNOWN';

export enum IntentType {
  ADHERENCE_QUERY = 'ADHERENCE_QUERY',
  MEDICATION_QUERY = 'MEDICATION_QUERY',
  PRESCRIPTION_QUERY = 'PRESCRIPTION_QUERY',
  LAB_RESULT_QUERY = 'LAB_RESULT_QUERY',
  DIAGNOSIS_QUERY = 'DIAGNOSIS_QUERY',
  ALLERGY_QUERY = 'ALLERGY_QUERY',
  GENERAL_HEALTH_QUERY = 'GENERAL_HEALTH_QUERY',
  GOVERNMENT_SCHEME_QUERY = 'GOVERNMENT_SCHEME_QUERY',
  FACILITY_QUERY = 'FACILITY_QUERY',
  TELECONSULTATION_QUERY = 'TELECONSULTATION_QUERY',
  REFERRAL_QUERY = 'REFERRAL_QUERY',
  GREETING = 'GREETING',
  CLARIFICATION = 'CLARIFICATION',
  UNKNOWN = 'UNKNOWN',
}

export interface IntentMetadata {
  intent: IntentType;
  confidence: number;
  requiresClinicalContext: boolean;
  requiredRecordCategories: HealthRecordCategory[];
  language: string;
  safetySensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  classifiedBy: 'RULE_ENGINE' | 'AI_MODEL';
  requirements?: {
    state?: string;
    district?: string;
    facilityType?: 'PUBLIC' | 'PRIVATE';
    scheme?: string;
    service?: string;
    recordCategories?: string[];
    knowledgeRequired?: boolean;
    responseRequirements?: string[];
    schemeInformationType?: SchemeInformationType;
  };
  /** Validated semantic plan; never populated from a keyword rule. */
  knowledgeRequired?: boolean;
  responseRequirements?: string[];
  schemeInformationType?: SchemeInformationType;
}
