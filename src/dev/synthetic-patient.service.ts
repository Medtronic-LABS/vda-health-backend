import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyntheticPatient } from '../database/entities/synthetic-patient.entity';
import { SyntheticPatientFeedback } from '../database/entities/synthetic-feedback.entity';

export type SyntheticPatientInput = Pick<SyntheticPatient, 'name' | 'age' | 'dateOfBirth' | 'gender' | 'state' | 'district' | 'city' | 'locality' | 'language'> & {
  phoneNumber?: string;
  clinicalProfile?: Record<string, unknown>;
  syntheticPatientId?: string;
};

@Injectable()
export class SyntheticPatientService {
  constructor(
    @InjectRepository(SyntheticPatient) private readonly patients: Repository<SyntheticPatient>,
    @InjectRepository(SyntheticPatientFeedback) private readonly feedback: Repository<SyntheticPatientFeedback>,
  ) {}

  async list(tenantId: string): Promise<SyntheticPatient[]> {
    return this.patients.find({ where: { tenantId }, order: { updatedAt: 'DESC' } });
  }

  async get(tenantId: string, id: string): Promise<SyntheticPatient> {
    const patient = await this.patients.findOne({ where: { id, tenantId } });
    if (!patient) throw new NotFoundException('SYNTHETIC_PATIENT_NOT_FOUND');
    return patient;
  }

  async getByReference(tenantId: string, reference: string): Promise<SyntheticPatient | null> {
    return this.patients.findOne({ where: { tenantId, syntheticPatientId: reference.replace(/^synthetic:/, '') } });
  }

  async create(tenantId: string, input: SyntheticPatientInput): Promise<SyntheticPatient> {
    const syntheticPatientId = input.syntheticPatientId?.trim() || `dev-${crypto.randomUUID()}`;
    return this.patients.save(this.patients.create({
      ...input,
      tenantId,
      syntheticPatientId,
      clinicalProfile: input.clinicalProfile || {},
      phoneNumber: input.phoneNumber || null,
    }));
  }

  async update(tenantId: string, id: string, input: Partial<SyntheticPatientInput>): Promise<SyntheticPatient> {
    const patient = await this.get(tenantId, id);
    Object.assign(patient, input);
    return this.patients.save(patient);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const patient = await this.get(tenantId, id);
    await this.patients.remove(patient);
  }

  async recordFeedback(tenantId: string, input: { syntheticPatientId: string; sessionId: string; responseId?: string; helpful: boolean; reason?: string }): Promise<void> {
    await this.feedback.save(this.feedback.create({ tenantId, ...input, responseId: input.responseId || null, reason: input.reason || null }));
  }
}
