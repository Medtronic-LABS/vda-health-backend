import { HealthRecordCategory } from '../../abdm/interfaces/health-record-service.interface';

export enum IntentType {
  MEDICATION_QUERY = 'MEDICATION_QUERY',
  PRESCRIPTION_QUERY = 'PRESCRIPTION_QUERY',
  LAB_RESULT_QUERY = 'LAB_RESULT_QUERY',
  DIAGNOSIS_QUERY = 'DIAGNOSIS_QUERY',
  ALLERGY_QUERY = 'ALLERGY_QUERY',
  GENERAL_HEALTH_QUERY = 'GENERAL_HEALTH_QUERY',
  GOVERNMENT_SCHEME_QUERY = 'GOVERNMENT_SCHEME_QUERY',
  FACILITY_QUERY = 'FACILITY_QUERY',
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
}
