import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { IAiProvider } from '../ai/interfaces/ai-provider.interface';
import { AuditService } from '../audit/audit.service';
import { HostIdentity } from '../auth/host-identity.context';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { Prescription, PrescriptionVerificationStatus } from '../database/entities/prescription.entity';
import { SyntheticPatient } from '../database/entities/synthetic-patient.entity';
import { MultiFormatParserService } from '../knowledge/ingestion/multi-format-parser.service';
import { PrescriptionDecisionDto, VerifyPrescriptionDto } from './dto/verify-prescription.dto';
import { PushNotificationsService } from '../notifications/push-notifications.service';

export interface PrescriptionPatientSummary {
  patientRef: string;
  patientType: 'MOBILE_USER' | 'SYNTHETIC_PATIENT' | 'PROTOTYPE';
  patientCode: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  phone: string | null;
  district: string | null;
  state: string | null;
  preferredLanguage: string | null;
  abhaNumber: string | null;
}

@Injectable()
export class PrescriptionService {
  private readonly logger = new Logger(PrescriptionService.name);
  constructor(
    @InjectRepository(Prescription) private readonly prescriptions: Repository<Prescription>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly parser: MultiFormatParserService,
    @Inject('IAiProvider') private readonly aiProvider: IAiProvider,
    @Optional() private readonly push?: PushNotificationsService,
  ) {}

  async upload(tenantId: string, patientRef: string, sessionId: string | null, file: { buffer: Buffer; filename: string; mimeType?: string }) {
    if (!file.buffer?.length) throw new BadRequestException('INVALID_FILE');
    const mimeType = file.mimeType || '';
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/markdown'].includes(mimeType)) throw new BadRequestException('UNSUPPORTED_FILE');
    const isMultimodal = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
    const parsed = isMultimodal ? { content: '', checksum: createHash('sha256').update(file.buffer).digest('hex') } : await this.parser.parseDocument(file.buffer, file.filename, file.mimeType);
    const extracted = isMultimodal ? await this.extractWithGemini(file) : null;
    const medications = extracted?.medicines || this.extractMedications(parsed.content);
    const investigations = extracted?.investigations || this.extractInvestigations(parsed.content);
    const extractionStatus = medications.length > 0 && medications.every((medicine: Record<string, string | null>) => {
      const name = medicine.medicationName || medicine.normalizedName;
      return Boolean(name?.trim()) && (medicine.confidence || 'HIGH').toUpperCase() !== 'LOW';
    }) ? 'EXTRACTED' : 'REVIEW_REQUIRED';
    const prescription = await this.prescriptions.save(this.prescriptions.create({
      tenantId, patientRef, sessionId, prescriptionId: randomUUID(), sourceDocumentId: randomUUID(), filename: file.filename,
      sourceMimeType: mimeType, sourceFile: file.buffer, checksum: parsed.checksum, extractedText: parsed.content,
      medications, investigations, extractionStatus,
      verificationStatus: extractionStatus === 'EXTRACTED' ? 'PENDING_VERIFICATION' : 'UNVERIFIED',
      prescriptionDate: this.parseDate(extracted?.prescriptionDate), prescriberName: extracted?.doctorName || null,
      verifiedMedications: null, verifiedInvestigations: null, planRevision: 1, activePlan: false,
    }));
    return this.patientView(prescription);
  }

  async list(tenantId: string, patientRef?: string) {
    const rows = await this.prescriptions.find({ where: patientRef ? { tenantId, patientRef } : { tenantId }, order: { createdAt: 'DESC' } });
    return rows.map((row) => this.patientView(row));
  }

  async listForPatient(tenantId: string, patientRef: string) {
    const rows = await this.prescriptions.find({ where: { tenantId, patientRef }, order: { activePlan: 'DESC', createdAt: 'DESC' } });
    return rows.map((row) => this.patientView(row));
  }

  async listForSession(tenantId: string, patientRef: string, sessionId: string) {
    const rows = await this.prescriptions.find({ where: { tenantId, patientRef, sessionId }, order: { createdAt: 'DESC' } });
    return rows.map((row) => this.patientView(row));
  }

  async currentSessionState(tenantId: string, patientRef: string, _sessionId: string) {
    const [activePlan, latestSubmission] = await Promise.all([
      this.prescriptions.findOne({ where: { tenantId, patientRef, verificationStatus: 'VERIFIED', activePlan: true }, order: { planRevision: 'DESC', createdAt: 'DESC' } }),
      this.prescriptions.findOne({ where: { tenantId, patientRef }, order: { createdAt: 'DESC' } }),
    ]);
    return {
      activePlan: activePlan ? this.patientView(activePlan) : null,
      latestSubmission: latestSubmission ? this.patientStatusView(latestSubmission) : null,
    };
  }

  async worklist(tenantId: string, status?: PrescriptionVerificationStatus) {
    const [rows, allTenantRows] = await Promise.all([
      this.prescriptions.find({ where: status ? { tenantId, verificationStatus: status } : { tenantId }, order: { createdAt: 'DESC' } }),
      status ? this.prescriptions.find({ where: { tenantId }, order: { createdAt: 'DESC' } }) : Promise.resolve(null),
    ]);
    const allRows = allTenantRows || rows;
    const patientRefs = [...new Set(allRows.map((row) => row.patientRef).filter(Boolean))];
    const patientMap = await this.resolvePatientMap(tenantId, patientRefs);
    const statsByPatient = new Map<string, { totalSubmissions: number; pendingCount: number; verifiedCount: number; activePrescriptionId: string | null }>();
    for (const row of allRows) {
      const current = statsByPatient.get(row.patientRef) || { totalSubmissions: 0, pendingCount: 0, verifiedCount: 0, activePrescriptionId: null };
      current.totalSubmissions += 1;
      if (row.verificationStatus === 'PENDING_VERIFICATION' || row.verificationStatus === 'UNVERIFIED') current.pendingCount += 1;
      if (row.verificationStatus === 'VERIFIED') current.verifiedCount += 1;
      if (row.activePlan && row.verificationStatus === 'VERIFIED') current.activePrescriptionId = row.id;
      statsByPatient.set(row.patientRef, current);
    }

    return rows.map((row) => {
      const meds = this.effectiveMedications(row);
      const invs = this.effectiveInvestigations(row);
      const patient = patientMap.get(row.patientRef) || this.fallbackPatientSummary(row.patientRef);
      const patientStats = statsByPatient.get(row.patientRef) || { totalSubmissions: 1, pendingCount: 0, verifiedCount: 0, activePrescriptionId: null };
      return {
        id: row.id,
        prescriptionCode: this.formatPrescriptionCode(row.id),
        patientRef: row.patientRef,
        patient,
        patientStats,
        prescriberName: row.prescriberName,
        prescriptionDate: row.prescriptionDate,
        medicationCount: meds.length,
        medicationPreview: this.extractMedicationPreview(meds),
        investigationCount: invs.length,
        filename: row.filename,
        sourceMimeType: row.sourceMimeType,
        extractionStatus: row.extractionStatus,
        verificationStatus: row.verificationStatus,
        planRevision: row.planRevision || 1,
        activePlan: Boolean(row.activePlan),
        reviewRequired: row.extractionStatus === 'REVIEW_REQUIRED' || row.verificationStatus === 'UNVERIFIED',
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async workerDetail(tenantId: string, id: string, identity: HostIdentity, correlationId: string) {
    const record = await this.findTenantRecord(tenantId, id);
    await this.auditAction(record, identity, correlationId, 'prescription_verification_opened');
    const [patientMap, patientRows] = await Promise.all([
      this.resolvePatientMap(tenantId, [record.patientRef]),
      typeof this.prescriptions.find === 'function'
        ? this.prescriptions.find({ where: { tenantId, patientRef: record.patientRef }, order: { createdAt: 'DESC' } })
        : Promise.resolve([record]),
    ]);
    const patient = patientMap.get(record.patientRef) || this.fallbackPatientSummary(record.patientRef);
    const safeRows = Array.isArray(patientRows) && patientRows.length > 0 ? patientRows : [record];
    const patientHistory = safeRows.map((item) => {
      const meds = this.effectiveMedications(item);
      const invs = this.effectiveInvestigations(item);
      return {
        id: item.id,
        prescriptionCode: this.formatPrescriptionCode(item.id),
        planRevision: item.planRevision || 1,
        verificationStatus: item.verificationStatus,
        extractionStatus: item.extractionStatus,
        activePlan: Boolean(item.activePlan),
        reviewRequired: item.extractionStatus === 'REVIEW_REQUIRED' || item.verificationStatus === 'UNVERIFIED',
        prescriberName: item.prescriberName,
        prescriptionDate: item.prescriptionDate,
        medicationCount: meds.length,
        medicationPreview: this.extractMedicationPreview(meds),
        investigationCount: invs.length,
        verifiedBy: item.verifiedBy,
        verifierRole: item.verifierRole,
        verifiedAt: item.verifiedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });
    const normalizedExtractedMeds = this.normalizeMedicationRows(record.medications);
    const normalizedVerifiedMeds = Array.isArray(record.verifiedMedications) && record.verifiedMedications.length > 0
      ? this.normalizeMedicationRows(record.verifiedMedications)
      : null;
    const normalizedExtractedInvs = this.normalizeInvestigationRows(record.investigations);
    const normalizedVerifiedInvs = Array.isArray(record.verifiedInvestigations) && record.verifiedInvestigations.length > 0
      ? this.normalizeInvestigationRows(record.verifiedInvestigations)
      : null;

    return {
      ...this.patientView(record),
      prescriptionCode: this.formatPrescriptionCode(record.id),
      patientRef: record.patientRef,
      patient,
      patientHistory,
      prescriptionDate: record.prescriptionDate,
      prescriberName: record.prescriberName,
      sourceMimeType: record.sourceMimeType,
      extractedText: record.extractedText || '',
      extractedMedications: normalizedExtractedMeds,
      extractedInvestigations: normalizedExtractedInvs,
      verifiedMedications: normalizedVerifiedMeds,
      verifiedInvestigations: normalizedVerifiedInvs,
      verificationNote: record.verificationNote,
      patientReviewReason: record.patientReviewReason,
      verifiedBy: record.verifiedBy,
      verifierRole: record.verifierRole,
      verifiedAt: record.verifiedAt,
    };
  }

  async source(tenantId: string, id: string, identity: HostIdentity, correlationId: string) {
    const record = await this.prescriptions.createQueryBuilder('p').addSelect('p.sourceFile').where('p.id = :id AND p.tenantId = :tenantId', { id, tenantId }).getOne();
    if (!record) throw new NotFoundException('PRESCRIPTION_NOT_FOUND');
    if (!record.sourceFile?.length) throw new NotFoundException('PRESCRIPTION_SOURCE_NOT_FOUND');
    await this.auditAction(record, identity, correlationId, 'prescription_source_opened');
    return { buffer: record.sourceFile, mimeType: record.sourceMimeType || 'application/octet-stream', filename: record.filename };
  }

  async verify(tenantId: string, id: string, dto: VerifyPrescriptionDto, identity: HostIdentity, correlationId: string) {
    if (!dto.medications.length || dto.medications.some((m) => !m.medicationName.trim())) throw new BadRequestException('VERIFIED_MEDICATION_REQUIRED');
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Prescription);
      const record = await repo.createQueryBuilder('p').setLock('pessimistic_write').where('p.id = :id AND p.tenantId = :tenantId', { id, tenantId }).getOne();
      if (!record) throw new NotFoundException('PRESCRIPTION_NOT_FOUND');
      if (['VERIFIED', 'REJECTED', 'NEEDS_RESUBMISSION', 'SUPERSEDED'].includes(record.verificationStatus)) throw new ConflictException('PRESCRIPTION_ALREADY_DECIDED');
      if (['FAILED', 'REJECTED'].includes(record.extractionStatus)) throw new BadRequestException('PRESCRIPTION_NOT_VERIFIABLE');
      const previousVerificationStatus = record.verificationStatus;
      const previous = await repo.createQueryBuilder('p').setLock('pessimistic_write').where('p.tenantId = :tenantId AND p.patientRef = :patientRef AND p.activePlan = true', { tenantId, patientRef: record.patientRef }).getOne();
      if (previous && previous.id !== record.id) {
        previous.activePlan = false;
        previous.verificationStatus = 'SUPERSEDED';
        await repo.save(previous);
        record.supersedesPrescriptionId = previous.id;
        record.planRevision = previous.planRevision + 1;
      }
      record.verifiedMedications = dto.medications.map((value) => ({ ...value, confidence: 'WORKER_VERIFIED' }));
      record.verifiedInvestigations = dto.investigations.map((value) => ({ ...value, confidence: 'WORKER_VERIFIED' }));
      record.verificationStatus = 'VERIFIED';
      record.activePlan = true;
      record.verifiedBy = identity.externalId;
      record.verifierRole = identity.workerRole!;
      record.verifiedAt = new Date();
      record.verificationNote = dto.note?.trim() || null;
      record.patientReviewReason = null;
      const saved = await repo.save(record);
      await this.push?.enqueuePrescriptionDecision(manager, saved);
      return { saved, previous, previousVerificationStatus };
    });
    if (result.previous && result.previous.id !== result.saved.id) await this.auditAction(result.previous, identity, correlationId, 'prescription_superseded', { previousVerificationStatus: 'VERIFIED', resultingVerificationStatus: 'SUPERSEDED' });
    const changedFields = this.changedFields(result.saved);
    if (changedFields.length) await this.auditAction(result.saved, identity, correlationId, 'prescription_corrected', { changedFields, previousVerificationStatus: result.previousVerificationStatus, resultingVerificationStatus: 'VERIFIED' });
    await this.auditAction(result.saved, identity, correlationId, 'prescription_verified', { changedFields, previousVerificationStatus: result.previousVerificationStatus, resultingVerificationStatus: 'VERIFIED' });
    this.push?.wake();
    return this.patientView(result.saved);
  }

  async reject(tenantId: string, id: string, dto: PrescriptionDecisionDto, identity: HostIdentity, correlationId: string, clearerImage: boolean) {
    if (!dto.reason?.trim()) throw new BadRequestException('DECISION_REASON_REQUIRED');
    const record = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Prescription);
      const current = await repo.createQueryBuilder('p').setLock('pessimistic_write').where('p.id = :id AND p.tenantId = :tenantId', { id, tenantId }).getOne();
      if (!current) throw new NotFoundException('PRESCRIPTION_NOT_FOUND');
      if (['VERIFIED', 'REJECTED', 'NEEDS_RESUBMISSION', 'SUPERSEDED'].includes(current.verificationStatus)) throw new ConflictException('PRESCRIPTION_ALREADY_DECIDED');
      const previousVerificationStatus = current.verificationStatus;
      current.verificationStatus = clearerImage ? 'NEEDS_RESUBMISSION' : 'REJECTED';
      current.activePlan = false;
      current.verifiedBy = identity.externalId;
      current.verifierRole = identity.workerRole!;
      current.verifiedAt = new Date();
      current.verificationNote = dto.note?.trim() || null;
      current.patientReviewReason = dto.reason.trim();
      const saved = await repo.save(current);
      await this.push?.enqueuePrescriptionDecision(manager, saved);
      return { saved, previousVerificationStatus };
    });
    await this.auditAction(record.saved, identity, correlationId, clearerImage ? 'prescription_resubmission_requested' : 'prescription_rejected', { reasonRecorded: true, previousVerificationStatus: record.previousVerificationStatus, resultingVerificationStatus: record.saved.verificationStatus });
    this.push?.wake();
    return this.patientView(record.saved);
  }

  async approve(_tenantId: string, _id: string) { throw new BadRequestException('LEGACY_PRESCRIPTION_APPROVAL_DISABLED'); }
  async approvedForPatient(tenantId: string, patientRef: string) { const rows = await this.prescriptions.find({ where: { tenantId, patientRef, verificationStatus: 'VERIFIED', activePlan: true }, order: { createdAt: 'DESC' } }); return rows.map((row) => this.patientView(row)); }

  private patientView(record: Prescription) { const verified = record.verificationStatus === 'VERIFIED'; return { id: record.id, prescriptionId: record.prescriptionId, sessionId: record.sessionId, filename: record.filename, medications: verified ? (record.verifiedMedications || []) : [], investigations: verified ? (record.verifiedInvestigations || []) : [], extractionStatus: record.extractionStatus, verificationStatus: record.verificationStatus, activePlan: record.activePlan, planRevision: record.planRevision, supersedesPrescriptionId: record.supersedesPrescriptionId, createdAt: record.createdAt, updatedAt: record.updatedAt }; }
  private patientStatusView(record: Prescription) {
    const decisionVisible = record.verificationStatus === 'REJECTED' || record.verificationStatus === 'NEEDS_RESUBMISSION';
    const extractionVisible = (record.verificationStatus === 'PENDING_VERIFICATION' || record.verificationStatus === 'UNVERIFIED')
      && (record.extractionStatus === 'EXTRACTED' || record.extractionStatus === 'REVIEW_REQUIRED');
    const field = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
    return {
      id: record.id,
      prescriptionId: record.prescriptionId,
      filename: record.filename,
      extractionStatus: record.extractionStatus,
      verificationStatus: record.verificationStatus,
      activePlan: record.activePlan,
      planRevision: record.planRevision,
      patientReviewReason: decisionVisible ? record.patientReviewReason : null,
      ...(extractionVisible ? {
        extractedDetails: {
          medications: record.medications.flatMap((item) => {
            const name = field(item.medicationName) || field(item.normalizedName);
            return name ? [{
              name,
              strength: field(item.strength),
              frequency: field(item.frequency),
              timing: field(item.timing),
              uncertain: item.confidence === 'LOW',
            }] : [];
          }),
          investigations: record.investigations.flatMap((item) => {
            const name = field(item.rawName) || field(item.normalizedName);
            return name ? [{ name, uncertain: item.confidence === 'LOW' }] : [];
          }),
        },
      } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  private async findTenantRecord(tenantId: string, id: string) { const record = await this.prescriptions.findOne({ where: { id, tenantId } }); if (!record) throw new NotFoundException('PRESCRIPTION_NOT_FOUND'); return record; }
  private formatPrescriptionCode(id: string): string {
    return `RX-${String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || '000000'}`;
  }
  private effectiveMedications(row: Partial<Prescription>): Array<Record<string, unknown>> {
    if (Array.isArray(row.verifiedMedications) && row.verifiedMedications.length > 0) {
      return this.normalizeMedicationRows(row.verifiedMedications);
    }
    return this.normalizeMedicationRows(row.medications);
  }
  private effectiveInvestigations(row: Partial<Prescription>): Array<Record<string, unknown>> {
    if (Array.isArray(row.verifiedInvestigations) && row.verifiedInvestigations.length > 0) {
      return this.normalizeInvestigationRows(row.verifiedInvestigations);
    }
    return this.normalizeInvestigationRows(row.investigations);
  }
  private normalizeMedicationRows(rows: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => {
        const medicationName = String(
          item.medicationName || item.rawName || item.name || item.normalizedName || '',
        ).trim();
        return {
          ...item,
          medicationName: medicationName || (item.medicationName ?? ''),
          normalizedName: item.normalizedName ?? null,
          strength: item.strength ?? null,
          dosage: item.dosage ?? null,
          dosageForm: item.dosageForm ?? null,
          route: item.route ?? null,
          frequency: item.frequency ?? null,
          timing: item.timing ?? null,
          duration: item.duration ?? null,
          instructions: item.instructions ?? null,
        };
      });
  }
  private normalizeInvestigationRows(rows: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => {
        const rawName = String(item.rawName || item.name || item.normalizedName || '').trim();
        return {
          ...item,
          rawName: rawName || (item.rawName ?? ''),
          normalizedName: item.normalizedName ?? (rawName || null),
          reason: item.reason ?? null,
          instructions: item.instructions ?? null,
        };
      });
  }
  private extractMedicationPreview(meds: Array<Record<string, unknown>>): string[] {
    return meds
      .map((item) => {
        const name = String(item.medicationName || item.rawName || item.name || item.normalizedName || '').trim();
        const strength = String(item.strength || '').trim();
        return name ? (strength && !name.toLowerCase().includes(strength.toLowerCase()) ? `${name} ${strength}` : name) : '';
      })
      .filter(Boolean)
      .slice(0, 3);
  }
  private fallbackPatientSummary(patientRef: string): PrescriptionPatientSummary {
    const safeRef = String(patientRef || 'unknown');
    if (safeRef.startsWith('mobile-user:')) {
      const id = safeRef.slice('mobile-user:'.length);
      return {
        patientRef: safeRef,
        patientType: 'MOBILE_USER',
        patientCode: `PT-${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'MOBILE'}`,
        fullName: `Mobile Patient (${id.slice(0, 8)})`,
        age: null,
        gender: null,
        phone: null,
        district: null,
        state: null,
        preferredLanguage: null,
        abhaNumber: null,
      };
    }
    if (safeRef.startsWith('synthetic:')) {
      const id = safeRef.slice('synthetic:'.length);
      return {
        patientRef: safeRef,
        patientType: 'SYNTHETIC_PATIENT',
        patientCode: id.toUpperCase(),
        fullName: `Synthetic Patient (${id})`,
        age: null,
        gender: null,
        phone: null,
        district: null,
        state: null,
        preferredLanguage: null,
        abhaNumber: null,
      };
    }
    return {
      patientRef: safeRef,
      patientType: 'PROTOTYPE',
      patientCode: `PT-${safeRef.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'DEMO'}`,
      fullName: safeRef.replace(/^(local-file:|dev-)/i, '') || 'Registered Patient',
      age: null,
      gender: null,
      phone: null,
      district: null,
      state: null,
      preferredLanguage: null,
      abhaNumber: null,
    };
  }
  private async resolvePatientMap(_tenantId: string, patientRefs: string[]): Promise<Map<string, PrescriptionPatientSummary>> {
    const map = new Map<string, PrescriptionPatientSummary>();
    for (const ref of patientRefs) {
      map.set(ref, this.fallbackPatientSummary(ref));
    }
    if (!patientRefs.length || typeof this.dataSource?.getRepository !== 'function') {
      return map;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const mobileIdToRefs = new Map<string, string[]>();
    const syntheticIdToRefs = new Map<string, string[]>();

    for (const ref of patientRefs) {
      if (ref.startsWith('mobile-user:')) {
        const id = ref.slice('mobile-user:'.length).trim();
        if (uuidRegex.test(id)) {
          mobileIdToRefs.set(id, [...(mobileIdToRefs.get(id) || []), ref]);
        }
      } else if (ref.startsWith('synthetic:')) {
        const id = ref.slice('synthetic:'.length).trim();
        if (id) {
          syntheticIdToRefs.set(id, [...(syntheticIdToRefs.get(id) || []), ref]);
        }
      } else if (uuidRegex.test(ref)) {
        mobileIdToRefs.set(ref, [...(mobileIdToRefs.get(ref) || []), ref]);
        syntheticIdToRefs.set(ref, [...(syntheticIdToRefs.get(ref) || []), ref]);
      } else if (ref.trim()) {
        syntheticIdToRefs.set(ref.trim(), [...(syntheticIdToRefs.get(ref.trim()) || []), ref]);
      }
    }

    const mobileIds = [...mobileIdToRefs.keys()];
    const syntheticIds = [...syntheticIdToRefs.keys()];

    try {
      if (mobileIds.length > 0) {
        const mobileRepo = this.dataSource.getRepository(MobileUser);
        if (typeof mobileRepo?.createQueryBuilder === 'function') {
          const users = await mobileRepo
            .createQueryBuilder('u')
            .addSelect('u.abhaNumber')
            .where('u.id IN (:...ids)', { ids: mobileIds })
            .getMany();
          for (const user of users) {
            const matchedRefs = mobileIdToRefs.get(user.id) || [`mobile-user:${user.id}`];
            for (const matchedRef of matchedRefs) {
              map.set(matchedRef, {
                patientRef: matchedRef,
                patientType: 'MOBILE_USER',
                patientCode: `PT-${user.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()}`,
                fullName: user.fullName,
                age: user.age ?? null,
                gender: user.gender ?? null,
                phone: user.phone ?? null,
                district: user.district ?? null,
                state: user.state ?? null,
                preferredLanguage: user.preferredLanguage ?? null,
                abhaNumber: user.abhaNumber ?? null,
              });
            }
          }
        }
      }
      if (syntheticIds.length > 0) {
        const syntheticRepo = this.dataSource.getRepository(SyntheticPatient);
        if (typeof syntheticRepo?.createQueryBuilder === 'function') {
          const syntheticUuids = syntheticIds.filter((id) => uuidRegex.test(id));
          const qb = syntheticRepo.createQueryBuilder('s');
          if (syntheticUuids.length > 0) {
            qb.where('s.syntheticPatientId IN (:...ids) OR s.id IN (:...uuids)', {
              ids: syntheticIds,
              uuids: syntheticUuids,
            });
          } else {
            qb.where('s.syntheticPatientId IN (:...ids)', { ids: syntheticIds });
          }
          const patients = await qb.getMany();
          for (const patient of patients) {
            const matchedRefs = [
              ...(syntheticIdToRefs.get(patient.syntheticPatientId) || []),
              ...(syntheticIdToRefs.get(patient.id) || []),
            ];
            for (const matchedRef of matchedRefs) {
              map.set(matchedRef, {
                patientRef: matchedRef,
                patientType: 'SYNTHETIC_PATIENT',
                patientCode: patient.syntheticPatientId,
                fullName: patient.name,
                age: patient.age ?? null,
                gender: patient.gender ?? null,
                phone: patient.phoneNumber ?? null,
                district: patient.district ?? null,
                state: patient.state ?? null,
                preferredLanguage: patient.language ?? null,
                abhaNumber: null,
              });
            }
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Patient detail enrichment fallback used: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    return map;
  }
  private changedFields(record: Prescription) {
    const fields: string[] = [];
    const compare = (prefix: string, extracted: Array<Record<string, unknown>>, verified: Array<Record<string, unknown>>) => {
      const count = Math.max(extracted.length, verified.length);
      for (let index = 0; index < count; index += 1) {
        const before = extracted[index] || {};
        const after = verified[index] || {};
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        keys.delete('confidence');
        for (const key of keys) if ((before[key] ?? null) !== (after[key] ?? null)) fields.push(`${prefix}[${index}].${key}`);
      }
    };
    compare('medications', record.medications, record.verifiedMedications || []);
    compare('investigations', record.investigations, record.verifiedInvestigations || []);
    return fields;
  }
  private parseDate(value?: string | null): Date | null { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
  private auditAction(record: Prescription, identity: HostIdentity, correlationId: string, action: string, details?: Record<string, unknown>) { return this.audit.logEvent({ tenantId: record.tenantId, subjectAbhaRef: record.patientRef, speaker: identity.workerRole || null, actingPrincipal: identity.externalId, correlationId, action, entityName: 'Prescription', entityId: record.id, details: details || null }); }

  private extractMedications(text: string): Array<Record<string, string | null>> { return text.split(/\r?\n/).flatMap((line) => { const match = line.trim().match(/^([A-Za-z][A-Za-z .-]{1,80}?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))\b(.*)$/i); if (!match) return []; const rest = match[3]!.trim(); const find = (pattern: RegExp) => rest.match(pattern)?.[0] || null; return [{ medicationName: match[1]!.trim(), strength: match[2]!.trim(), dosage: find(/\b\d+\s*(?:tablet|tab|capsule|cap|ml)\b/i), frequency: find(/\b(?:once|twice|three times)\s+(?:a\s+)?daily\b|\b(?:OD|BD|TDS)\b/i), route: find(/\b(?:oral|topical|inhaled|injection)\b/i), timing: find(/\b(?:morning|afternoon|night|before meals|after meals|with meals)\b/i), duration: find(/\b(?:for\s+)?\d+\s+days?\b/i), instructions: rest || null }]; }); }
  private extractInvestigations(text: string): Array<Record<string, string | null>> { const known = /\b(HbA1c|CBC|Lipid Profile|Creatinine|Blood Sugar|Fasting Blood Sugar|PPBS)\b/ig; const found = new Map<string, string>(); for (const match of text.matchAll(known)) { const rawName = match[0].trim(); found.set(rawName.toLowerCase(), rawName); } return [...found.values()].map((rawName) => ({ rawName, normalizedName: rawName, reason: null, instructions: null, confidence: 'HIGH' })); }
  private async extractWithGemini(file: { buffer: Buffer; filename: string; mimeType?: string }) {
    const extractionPrompt = `You are extracting information from a patient's prescription image or PDF.\n\nDOCUMENT EXTRACTION ONLY. Read only facts actually visible in the document; do not provide medical explanation or advice. Do not guess handwriting. If a medicine name, dosage, frequency, timing, duration, diagnosis, test, doctor name, or date is unclear, return null and use LOW confidence. Return only the requested JSON structure.`;
    try { const providerHealth = await this.aiProvider.healthCheck(); if (providerHealth.status !== 'AVAILABLE') throw new ServiceUnavailableException('PRESCRIPTION_SERVICE_UNAVAILABLE'); const result = await this.aiProvider.generate(extractionPrompt, { responseFormat: 'json', temperature: 0, timeoutMs: 120000, telemetryLabel: 'MULTIMODAL_PRESCRIPTION', inlineData: [{ mimeType: file.mimeType || 'application/octet-stream', data: file.buffer }], jsonSchema: this.prescriptionExtractionSchema() }); const json: any = result.json; const schemaValid = Boolean(json && Array.isArray(json.medicines) && Array.isArray(json.investigations)); if (process.env.NODE_ENV === 'development') this.logger.log(`[MULTIMODAL_PRESCRIPTION] model=${result.model} mime=${file.mimeType || 'unknown'} json_valid=${Boolean(json)} schema_valid=${schemaValid}`); if (!schemaValid) throw new Error('INVALID_PRESCRIPTION_EXTRACTION'); return { prescriptionDate: json.prescriptionDate || null, doctorName: json.doctorName || null, medicines: json.medicines.map((m: any) => ({ medicationName: m.rawName || null, normalizedName: m.normalizedName || null, strength: m.strength || null, dosage: m.dosage || null, dosageForm: m.dosageForm || null, route: m.route || null, frequency: m.frequency || null, timing: m.timing || null, duration: m.duration || null, instructions: m.instructions || null, confidence: m.confidence || 'LOW' })), investigations: json.investigations.map((i: any) => ({ rawName: i.rawName || null, normalizedName: i.normalizedName || null, reason: i.reason || null, instructions: i.instructions || null, confidence: i.confidence || 'LOW' })) }; } catch (error: unknown) { if (error instanceof ServiceUnavailableException) throw error; const category = error instanceof Error ? error.message.replace(/\s+/g, '_').slice(0, 160) : 'UNKNOWN'; if (process.env.NODE_ENV === 'development') this.logger.warn(`[MULTIMODAL_PRESCRIPTION] mime=${file.mimeType || 'unknown'} validation=false provider_error=${category}`); const providerFailure = error instanceof Error && /GEMINI_PROVIDER_UNAVAILABLE|Gemini API returned status (401|403|408|429|500|502|503|504)|abort|timeout/i.test(error.message); if (providerFailure) throw new ServiceUnavailableException('PRESCRIPTION_SERVICE_UNAVAILABLE'); throw new BadRequestException('PRESCRIPTION_EXTRACTION_FAILED'); }
  }
  private prescriptionExtractionSchema(): Record<string, unknown> { const nullableString = { type: 'STRING', nullable: true }; const confidence = { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] }; return { type: 'OBJECT', properties: { prescriptionDate: nullableString, doctorName: nullableString, facilityName: nullableString, diagnosis: nullableString, medicines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { rawName: nullableString, normalizedName: nullableString, strength: nullableString, dosage: nullableString, dosageForm: nullableString, route: nullableString, frequency: nullableString, timing: nullableString, duration: nullableString, instructions: nullableString, confidence } } }, investigations: { type: 'ARRAY', items: { type: 'OBJECT', properties: { rawName: nullableString, normalizedName: nullableString, reason: nullableString, instructions: nullableString, confidence } } }, instructions: { type: 'ARRAY', items: nullableString }, followUp: nullableString }, required: ['medicines', 'investigations'] }; }
}
