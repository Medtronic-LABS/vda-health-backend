import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { IAiProvider } from '../ai/interfaces/ai-provider.interface';
import { AuditService } from '../audit/audit.service';
import { HostIdentity } from '../auth/host-identity.context';
import { Prescription, PrescriptionVerificationStatus } from '../database/entities/prescription.entity';
import { MultiFormatParserService } from '../knowledge/ingestion/multi-format-parser.service';
import { PrescriptionDecisionDto, VerifyPrescriptionDto } from './dto/verify-prescription.dto';

@Injectable()
export class PrescriptionService {
  private readonly logger = new Logger(PrescriptionService.name);
  constructor(
    @InjectRepository(Prescription) private readonly prescriptions: Repository<Prescription>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly parser: MultiFormatParserService,
    @Inject('IAiProvider') private readonly aiProvider: IAiProvider,
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
    const rows = await this.prescriptions.find({ where: status ? { tenantId, verificationStatus: status } : { tenantId }, order: { createdAt: 'ASC' } });
    return rows.map((row) => ({ id: row.id, patientRef: row.patientRef, filename: row.filename, sourceMimeType: row.sourceMimeType, extractionStatus: row.extractionStatus, verificationStatus: row.verificationStatus, planRevision: row.planRevision, activePlan: row.activePlan, reviewRequired: row.extractionStatus === 'REVIEW_REQUIRED', createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  async workerDetail(tenantId: string, id: string, identity: HostIdentity, correlationId: string) {
    const record = await this.findTenantRecord(tenantId, id);
    await this.auditAction(record, identity, correlationId, 'prescription_verification_opened');
    return { ...this.patientView(record), prescriptionDate: record.prescriptionDate, prescriberName: record.prescriberName, sourceMimeType: record.sourceMimeType, extractedMedications: record.medications, extractedInvestigations: record.investigations, verifiedMedications: record.verifiedMedications, verifiedInvestigations: record.verifiedInvestigations, verificationNote: record.verificationNote, patientReviewReason: record.patientReviewReason, verifiedBy: record.verifiedBy, verifierRole: record.verifierRole, verifiedAt: record.verifiedAt };
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
      return { saved: await repo.save(record), previous, previousVerificationStatus };
    });
    if (result.previous && result.previous.id !== result.saved.id) await this.auditAction(result.previous, identity, correlationId, 'prescription_superseded', { previousVerificationStatus: 'VERIFIED', resultingVerificationStatus: 'SUPERSEDED' });
    const changedFields = this.changedFields(result.saved);
    if (changedFields.length) await this.auditAction(result.saved, identity, correlationId, 'prescription_corrected', { changedFields, previousVerificationStatus: result.previousVerificationStatus, resultingVerificationStatus: 'VERIFIED' });
    await this.auditAction(result.saved, identity, correlationId, 'prescription_verified', { changedFields, previousVerificationStatus: result.previousVerificationStatus, resultingVerificationStatus: 'VERIFIED' });
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
      return { saved: await repo.save(current), previousVerificationStatus };
    });
    await this.auditAction(record.saved, identity, correlationId, clearerImage ? 'prescription_resubmission_requested' : 'prescription_rejected', { reasonRecorded: true, previousVerificationStatus: record.previousVerificationStatus, resultingVerificationStatus: record.saved.verificationStatus });
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
