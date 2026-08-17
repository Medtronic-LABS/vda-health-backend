/**
 * IClinicalContextService — Provider-independent clinical context assembly interface.
 *
 * The ClinicalContextService is responsible for:
 *  1. Validating VDA record_read consent
 *  2. Mapping intent → required record categories
 *  3. Calling IHealthRecordService (never calling ABDM directly)
 *  4. Normalizing raw records → typed VDA context models
 *  5. Applying relevance filtering and staleness rules
 *  6. Deduplicating records
 *  7. Minimizing fields (AI receives only required fields)
 *  8. Producing the compact ClinicalContext
 *  9. Emitting audit events
 *
 * The AI Orchestrator (future Phase 7/8) receives only the ClinicalContext object.
 * It must NEVER directly call IHealthRecordService or access raw FHIR data.
 */
import { ClinicalContext } from '../models/clinical-context.models';

export interface ClinicalContextRequest {
  sessionId: string;
  tenantId: string;
  /**
   * Authorized subject reference from HostIdentity.
   * Must come from verified session — NOT from patient-supplied input.
   */
  subjectAbhaRef: string;
  /**
   * The VDA consent artifact ID for the active session.
   * Used to verify record_read scope before any records are fetched.
   */
  vdaConsentArtifactId: string;
  /**
   * Intent string classifying the patient query.
   * Drives which record categories are fetched.
   * Populated by Phase 7/8 intent classifier.
   * For Phase 5, callers pass the intent string directly.
   */
  intent: string;
  correlationId: string;
  /**
   * ABDM consent artefact reference — required for live ABDM integration.
   * DECISION_REQUIRED: How the host Patient App passes this to VDA.
   * Development implementation does NOT use this field.
   */
  abdmConsentArtefactRef?: string;
}

export interface IClinicalContextService {
  buildContext(request: ClinicalContextRequest): Promise<ClinicalContext>;
}
