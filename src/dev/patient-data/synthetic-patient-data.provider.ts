import { Injectable } from '@nestjs/common';
import { SyntheticPatientService } from '../synthetic-patient.service';
import {
  PatientClinicalProfile,
  PatientDataProvider,
  PatientDataRecord,
  PatientDataSummary,
} from './patient-data-provider.interface';

/** Adapts the existing development profiles without leaking that storage into VDA core. */
@Injectable()
export class SyntheticPatientDataProvider implements PatientDataProvider {
  constructor(private readonly patients: SyntheticPatientService) {}

  async getPatients(tenantId: string): Promise<PatientDataSummary[]> {
    const patients = await this.patients.list(tenantId);
    return patients.map((patient) => this.summary(patient));
  }

  async getPatient(tenantId: string, patientId: string): Promise<PatientDataRecord | null> {
    try {
      return this.record(await this.patients.get(tenantId, patientId));
    } catch {
      return null;
    }
  }

  async getClinicalContext(tenantId: string, patientId: string): Promise<PatientClinicalProfile | null> {
    return (await this.getPatient(tenantId, patientId))?.clinicalProfile ?? null;
  }

  async getPatientByReference(tenantId: string, subjectReference: string): Promise<PatientDataRecord | null> {
    const patient = await this.patients.getByReference(tenantId, subjectReference);
    return patient ? this.record(patient) : null;
  }

  private summary(patient: { id: string; name: string; age: number; gender: string; language: string; state: string; district: string; timezone?: string }): PatientDataSummary {
    return { id: patient.id, name: patient.name, age: patient.age, gender: patient.gender, language: patient.language, state: patient.state, district: patient.district, timezone: patient.timezone, source: 'synthetic' };
  }

  private record(patient: { id: string; name: string; age: number; gender: string; language: string; state: string; district: string; timezone?: string; clinicalProfile: Record<string, unknown> }): PatientDataRecord {
    const profile = patient.clinicalProfile;
    const records = (name: string): Array<Record<string, unknown>> => Array.isArray(profile[name]) ? profile[name] as Array<Record<string, unknown>> : [];
    return {
      ...this.summary(patient),
      clinicalProfile: {
        diagnoses: records('diagnoses'), medications: records('medications'), labResults: records('labResults'), allergies: records('allergies'), prescriptions: records('prescriptions'), carePlans: records('carePlans'), encounters: records('encounters'), scheduledEvents: records('scheduledEvents') as PatientClinicalProfile['scheduledEvents'],
      },
    };
  }
}
