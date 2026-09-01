import { Injectable } from '@nestjs/common';
import {
  PatientClinicalProfile,
  PatientDataProvider,
  PatientDataRecord,
  PatientDataSummary,
} from './patient-data-provider.interface';
import { FilePatientDataProvider } from './file-patient-data.provider';
import { SyntheticPatientDataProvider } from './synthetic-patient-data.provider';

/**
 * Resolves a server-created subject reference to exactly one provider record.
 * This is the only demo adapter injected into VDA's health-record boundary.
 */
@Injectable()
export class CompositePatientDataProvider implements PatientDataProvider {
  constructor(
    private readonly files: FilePatientDataProvider,
    private readonly synthetic: SyntheticPatientDataProvider,
  ) {}

  getPatients(tenantId: string): Promise<PatientDataSummary[]> {
    return this.files.getPatients(tenantId);
  }

  getPatient(tenantId: string, patientId: string): Promise<PatientDataRecord | null> {
    return this.files.getPatient(tenantId, patientId);
  }

  getClinicalContext(tenantId: string, patientId: string): Promise<PatientClinicalProfile | null> {
    return this.files.getClinicalContext(tenantId, patientId);
  }

  async getPatientByReference(tenantId: string, subjectReference: string): Promise<PatientDataRecord | null> {
    if (subjectReference.startsWith('local-file:')) return this.files.getPatientByReference(tenantId, subjectReference);
    if (subjectReference.startsWith('synthetic:')) return this.synthetic.getPatientByReference(tenantId, subjectReference);
    return null;
  }
}
