import { Injectable } from '@nestjs/common';
import {
  PatientClinicalProfile,
  PatientDataProvider,
  PatientDataRecord,
  PatientDataSummary,
} from './patient-data-provider.interface';
import { FilePatientDataProvider } from './file-patient-data.provider';
import { SyntheticPatientDataProvider } from './synthetic-patient-data.provider';
import { MobileUserDataProvider } from './mobile-user-data.provider';

/**
 * Resolves a server-created subject reference to exactly one provider record.
 * This is the only demo adapter injected into VDA's health-record boundary.
 */
@Injectable()
export class CompositePatientDataProvider implements PatientDataProvider {
  constructor(
    private readonly files: FilePatientDataProvider,
    private readonly synthetic: SyntheticPatientDataProvider,
    private readonly mobileUsers: MobileUserDataProvider,
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
    if (subjectReference.startsWith('mobile-user:')) return this.mobileUsers.getPatientByReference(tenantId, subjectReference);
    if (subjectReference.startsWith('local-file:')) return this.files.getPatientByReference(tenantId, subjectReference);
    if (subjectReference.startsWith('synthetic:')) return this.synthetic.getPatientByReference(tenantId, subjectReference);
    return (await this.files.getPatient(tenantId, subjectReference)) || (await this.synthetic.getPatient(tenantId, subjectReference));
  }
}
