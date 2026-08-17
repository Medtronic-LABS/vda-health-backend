import { HealthRecordCategory } from '../interfaces/health-record-service.interface';

/**
 * IntentToRecordCategoryMapper
 *
 * Maps a patient query intent string to the minimal set of HealthRecordCategory
 * values required to answer that intent. This is a static configuration table.
 *
 * Phase 7/8 AI intent classification will populate the intent string.
 * For Phase 5, callers pass the intent string directly.
 *
 * Data minimization: only the categories listed here will be fetched.
 * No intent maps to ALL categories — that would violate the data minimization principle.
 *
 * GENERAL_HEALTH_QUERY intentionally returns [] because the query scope is too broad
 * to determine which records are required without further intent refinement.
 * DECISION_REQUIRED: define a controlled subset for GENERAL_HEALTH_QUERY in Phase 7/8.
 */
export class IntentToRecordCategoryMapper {
  private static readonly MAPPING: Record<string, HealthRecordCategory[]> = {
    MEDICATION_QUERY: [
      HealthRecordCategory.MEDICATION,
      HealthRecordCategory.PRESCRIPTION,
    ],
    PRESCRIPTION_QUERY: [
      HealthRecordCategory.PRESCRIPTION,
      HealthRecordCategory.MEDICATION,
    ],
    LAB_RESULT_QUERY: [
      HealthRecordCategory.LAB_REPORT,
      HealthRecordCategory.INVESTIGATION,
    ],
    DIAGNOSIS_QUERY: [HealthRecordCategory.DIAGNOSIS],
    ALLERGY_QUERY: [HealthRecordCategory.ALLERGY],
    // GENERAL_HEALTH_QUERY: intentionally empty — see above
    GENERAL_HEALTH_QUERY: [],
    // UNKNOWN: no records fetched; AI responds without clinical context
    UNKNOWN: [],
  };

  /**
   * Returns the list of categories required for the given intent.
   * Returns [] for unknown or unrecognised intents — never throws.
   */
  static getCategories(intent: string): HealthRecordCategory[] {
    return IntentToRecordCategoryMapper.MAPPING[intent] ?? [];
  }

  /**
   * Returns all known intent keys (useful for validation and testing).
   */
  static knownIntents(): string[] {
    return Object.keys(IntentToRecordCategoryMapper.MAPPING);
  }
}
