/**
 * IHealthRecordService — Provider-independent health record retrieval interface.
 *
 * The rest of VDA depends only on this interface. The concrete implementation
 * (DevelopmentHealthRecordService in dev, AbdmHealthRecordService in production)
 * is injected at module level.
 *
 * DECISION_REQUIRED (for production AbdmHealthRecordService):
 *   - ABDM HIE-CM/HIU API specification (NHA)
 *   - ABDM Gateway base URL (sandbox + production)
 *   - HIU client credential type and registration
 *   - FHIR R4 resource profiles used in ABDM India
 *   - Push vs. Pull data model for ABDM HIE
 *   - Host app mechanism to pass ABDM consent artefact reference to VDA
 *   - Request signing / ECDH encryption requirements
 */

export enum HealthRecordCategory {
  MEDICATION = 'MEDICATION',
  PRESCRIPTION = 'PRESCRIPTION',
  DIAGNOSIS = 'DIAGNOSIS',
  LAB_REPORT = 'LAB_REPORT',
  INVESTIGATION = 'INVESTIGATION',
  ALLERGY = 'ALLERGY',
  // Future categories require DECISION_REQUIRED before adding:
  // ENCOUNTER, VITALS, CLINICAL_DOCUMENT, IMMUNIZATION
}

export interface HealthRecordSubjectContext {
  /** Internal VDA tenant identifier — always required for isolation */
  tenantId: string;
  /**
   * Authorized subject reference from HostIdentity.
   * NEVER log raw. NEVER expose in responses.
   * Must come from the verified HostIdentity — not from patient-supplied input.
   *
   * DECISION_REQUIRED: Trust model for production subjectAbhaRef (ADR-002).
   */
  subjectAbhaRef: string;
  /**
   * VDA session identifier for correlation.
   */
  sessionId: string;
  /**
   * Request correlation ID for audit tracing.
   */
  correlationId: string;
  /**
   * ABDM Health Information Consent Artefact reference.
   * Required for live ABDM integration.
   *
   * DECISION_REQUIRED: Exact type, format, and handoff mechanism from Patient App.
   * Development implementation does NOT use this field.
   */
  abdmConsentArtefactRef?: string;
}

export interface HealthRecordRequest {
  subjectContext: HealthRecordSubjectContext;
  /** Only categories required by intent — never all categories by default */
  categories: HealthRecordCategory[];
  /** Optional: filter records older than this date */
  dateRangeStart?: Date;
  /** Optional: filter records newer than this date (for lab ordering) */
  dateRangeEnd?: Date;
}

export interface RawHealthRecord {
  /** Category this record belongs to */
  category: HealthRecordCategory;
  /**
   * Opaque source reference. Never a raw ABHA ID or patient name.
   * Safe for use in audit metadata.
   */
  sourceRef: string;
  /** Raw record payload — format depends on the implementing provider */
  payload: Record<string, unknown>;
  /** UTC timestamp when this record was fetched */
  fetchedAt: Date;
}

export interface RawHealthRecordBundle {
  category: HealthRecordCategory;
  records: RawHealthRecord[];
  /** true if some sources timed out or returned errors for this category */
  partialResult: boolean;
  fetchedAt: Date;
}

export interface HealthRecordResult {
  bundles: RawHealthRecordBundle[];
  /** Categories that could not be fetched (provider error, timeout, etc.) */
  unavailableCategories: HealthRecordCategory[];
  /** Opaque error codes — no raw provider details */
  providerErrorCodes: string[];
}

export interface IHealthRecordService {
  fetchRecords(request: HealthRecordRequest): Promise<HealthRecordResult>;
}
