/**
 * Normalized VDA clinical context models.
 *
 * These models are independent of FHIR R4 and independent of ABDM payload structure.
 * The conversion from FHIR R4 → these models belongs in the ABDM adapter layer (src/abdm/).
 * No FHIR library types are imported here.
 */

// ---------------------------------------------------------------------------
// Medication
// ---------------------------------------------------------------------------
export interface MedicationContext {
  medicationName: string;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
  startDate: Date | null;
  endDate: Date | null;
  /** 'active' | 'stopped' | 'completed' | 'unknown' */
  status: string;
  /**
   * Opaque source reference — identifies the originating record for provenance.
   * Never a raw ABHA number, patient name, or provider identifier.
   * Safe for audit metadata but NOT for AI context.
   */
  sourceRef: string;
  retrievedAt: Date;
}

// ---------------------------------------------------------------------------
// Prescription
// ---------------------------------------------------------------------------
export interface PrescriptionContext {
  medicationName: string;
  prescriptionDate: Date | null;
  /**
   * Opaque reference to the prescribing provider if available and permitted.
   * DECISION_REQUIRED: Confirm whether ABDM FHIR profiles expose practitioner refs.
   */
  prescribingProviderRef: string | null;
  instructions: string | null;
  /** 'active' | 'completed' | 'unknown' */
  status: string;
  sourceRef: string;
  retrievedAt: Date;
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------
export interface DiagnosisContext {
  conditionName: string;
  severity: string | null;
  onsetDate: Date | null;
  /** 'active' | 'resolved' | 'unknown' */
  status: string;
  sourceRef: string;
  retrievedAt: Date;
}

// ---------------------------------------------------------------------------
// Lab Result (covers both LAB_REPORT and INVESTIGATION categories)
// ---------------------------------------------------------------------------
export interface LabResultContext {
  testName: string;
  /** String representation of the result value (numeric or categorical) */
  value: string | null;
  unit: string | null;
  /** Reference range string if available, e.g. "3.5–5.0" */
  referenceRange: string | null;
  /** 'normal' | 'abnormal' | 'unknown' */
  interpretation: string | null;
  observationDate: Date | null;
  sourceRef: string;
  retrievedAt: Date;
}

// ---------------------------------------------------------------------------
// Allergy
// ---------------------------------------------------------------------------
export interface AllergyContext {
  allergen: string;
  reactionType: string | null;
  severity: string | null;
  /** 'active' | 'resolved' | 'unknown' */
  status: string;
  sourceRef: string;
  retrievedAt: Date;
}

// ---------------------------------------------------------------------------
// ClinicalContext — the AI-ready compact context object
// ---------------------------------------------------------------------------
import { HealthRecordCategory } from '../interfaces/health-record-service.interface';

export interface ClinicalContext {
  /** VDA session identifier */
  sessionId: string;
  /**
   * HMAC of subjectAbhaRef — never the raw ABHA reference.
   * Allows correlation without exposing patient identity.
   */
  subjectRef: string;
  /** Intent that drove this context assembly */
  intent: string;
  medications?: MedicationContext[];
  prescriptions?: PrescriptionContext[];
  diagnoses?: DiagnosisContext[];
  labResults?: LabResultContext[];
  allergies?: AllergyContext[];
  /**
   * Categories that were requested but could not be retrieved.
   * AI must acknowledge unavailability rather than fabricating data.
   */
  unavailableCategories: HealthRecordCategory[];
  /** True if any provider returned partial results */
  partialResult: boolean;
  /** UTC timestamp of this context assembly */
  retrievalTimestamp: Date;
  /**
   * Version of the VDA consent artifact active at time of retrieval.
   * Used to detect if context is stale relative to consent changes.
   */
  consentVersion: string;
}
