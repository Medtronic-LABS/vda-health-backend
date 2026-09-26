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

/**
 * Product-authority decision made before domain-agent routing.  This is
 * deliberately separate from the existing, more detailed IntentType values:
 * the authority category decides whether VDA may handle the request at all,
 * while the intent selects an implementation only for an allowed service.
 */
export enum AuthorityCategory {
  MEDICATION_ADHERENCE = 'MEDICATION_ADHERENCE',
  FACILITY_NAVIGATION = 'FACILITY_NAVIGATION',
  SCHEME_ENTITLEMENT = 'SCHEME_ENTITLEMENT',
  CLINICAL_QUESTION = 'CLINICAL_QUESTION',
  POSSIBLE_EMERGENCY = 'POSSIBLE_EMERGENCY',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  UNCERTAIN = 'UNCERTAIN',
}

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
  authorityCategory: AuthorityCategory;
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
    /** Expressed affordability/access preference; never proof of coverage. */
    costPreference?: 'LOW_COST';
    iphsLevel?: 'HWC_SHC' | 'HWC_PHC' | 'CHC' | 'SDH' | 'DH';
    referralLevel?: 'PRIMARY' | 'SECONDARY' | 'DISTRICT';
    scheme?: string;
    service?: string;
    serviceAliases?: string[];
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
