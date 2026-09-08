/**
 * PatientDataProvider is the demo/host-data boundary for VDA.
 *
 * The VDA orchestration layer never receives a selector value. It receives a
 * session whose server-authorized subject reference is resolved here. A future
 * DenisPatientApiProvider can replace the local-file implementation without
 * changing ClinicalContext, agents, RAG, SafetyGate, or response formatting.
 */
export const PATIENT_DATA_PROVIDER = 'PatientDataProvider';

export type PatientDataSource = 'local-file' | 'synthetic';

export interface PatientDataSummary {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  language?: string;
  state?: string;
  district?: string;
  timezone?: string;
  source: PatientDataSource;
}

export type ScheduledClinicalEventType = 'CLINICAL_REVIEW' | 'MEDICATION_REVIEW' | 'LAB_REVIEW' | 'CHECKUP';

/** Provider-neutral, source-backed scheduled clinical event. It is not an appointment booking record. */
export interface ScheduledClinicalEvent extends Record<string, unknown> {
  id?: string;
  type: ScheduledClinicalEventType;
  title: string;
  dueDate: string;
  condition?: string;
  source?: string;
  guidance?: string;
}

export interface PatientClinicalProfile {
  diagnoses: Array<Record<string, unknown>>;
  medications: Array<Record<string, unknown>>;
  labResults: Array<Record<string, unknown>>;
  allergies: Array<Record<string, unknown>>;
  prescriptions: Array<Record<string, unknown>>;
  carePlans: Array<Record<string, unknown>>;
  encounters: Array<Record<string, unknown>>;
  scheduledEvents: ScheduledClinicalEvent[];
}

export interface PatientDataRecord extends PatientDataSummary {
  clinicalProfile: PatientClinicalProfile;
}

export interface PatientDataProvider {
  getPatients(tenantId: string): Promise<PatientDataSummary[]>;
  getPatient(tenantId: string, patientId: string): Promise<PatientDataRecord | null>;
  getClinicalContext(tenantId: string, patientId: string): Promise<PatientClinicalProfile | null>;
  getPatientByReference(tenantId: string, subjectReference: string): Promise<PatientDataRecord | null>;
}
