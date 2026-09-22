import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MobileUser } from '../../database/entities/mobile-user.entity';
import { PatientClinicalProfile, PatientDataProvider, PatientDataRecord, PatientDataSummary } from './patient-data-provider.interface';

const emptyClinicalProfile = (): PatientClinicalProfile => ({
  diagnoses: [], medications: [], labResults: [], allergies: [],
  prescriptions: [], carePlans: [], encounters: [], scheduledEvents: [],
});

@Injectable()
export class MobileUserDataProvider implements PatientDataProvider {
  constructor(@InjectRepository(MobileUser) private readonly users: Repository<MobileUser>) {}
  async getPatients(): Promise<PatientDataSummary[]> { return []; }
  async getPatient(tenantId: string, patientId: string): Promise<PatientDataRecord | null> {
    const user = await this.users.findOne({ where: { id: patientId, tenantId, isActive: true } });
    return user ? this.record(user) : null;
  }
  async getClinicalContext(tenantId: string, patientId: string): Promise<PatientClinicalProfile | null> {
    return (await this.getPatient(tenantId, patientId))?.clinicalProfile || null;
  }
  async getPatientByReference(tenantId: string, subjectReference: string): Promise<PatientDataRecord | null> {
    if (!subjectReference.startsWith('mobile-user:')) return null;
    return this.getPatient(tenantId, subjectReference.slice('mobile-user:'.length));
  }
  private record(user: MobileUser): PatientDataRecord {
    return {
      id: user.id, name: user.fullName, age: user.age, gender: user.gender,
      language: user.preferredLanguage, state: user.state, district: user.district,
      timezone: 'Asia/Kolkata', source: 'mobile-profile', clinicalProfile: emptyClinicalProfile(),
    };
  }
}
