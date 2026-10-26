import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { IAiProvider } from '../ai/interfaces/ai-provider.interface';
import { AuditService } from '../audit/audit.service';
import { HostIdentity } from '../auth/host-identity.context';
import { ConsentService } from '../consent/consent.service';
import { MedicalReport } from '../database/entities/medical-report.entity';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { Session } from '../database/entities/session.entity';
import { OcrLine, ReportOcrService } from './report-ocr.service';

type ReportFact = { name: string; value: string; unit: string | null; referenceRange: string | null; evidence: string;
  source?: { page: number; confidence: number; bbox: OcrLine['bbox']; rotationDegrees?: number } };
type ReportFacts = { reportName: string | null; reportDate: string | null; tests: ReportFact[];
  verification?: 'INDEPENDENT_OCR_V1' | 'PDF_TEXT_LAYER_V1'; partialReading?: boolean };
type UploadFile = { buffer: Buffer; originalname: string; mimetype: string };

@Injectable()
export class MedicalReportService {
  constructor(
    @InjectRepository(MedicalReport) private readonly reports: Repository<MedicalReport>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly consent: ConsentService,
    private readonly ocr: ReportOcrService,
    private readonly audit: AuditService,
    @Inject('IAiProvider') private readonly ai: IAiProvider,
  ) {}

  private async scope(sessionId: string, identity: HostIdentity) {
    if (identity.authType !== 'MOBILE' || !identity.mobileUserId) throw new ForbiddenException('MOBILE_PATIENT_REQUIRED');
    const subject = `mobile-user:${identity.mobileUserId}`;
    const session = await this.sessions.findOne({ where: { id: sessionId, tenantId: identity.tenantId } });
    if (!session || session.externalId !== identity.externalId || session.subjectAbhaRef !== subject) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    const now = new Date();
    if (session.status !== 'ACTIVE' || now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) {
      throw new ForbiddenException('SESSION_EXPIRED');
    }
    await this.consent.validateConsent(session.consentArtifactId, identity.tenantId, identity.externalId, ['record_read']);
    return { subject, consentArtifactId: session.consentArtifactId };
  }

  private validateFile(file?: UploadFile): 'application/pdf' | 'image/jpeg' | 'image/png' {
    if (!file?.buffer?.length || file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException('INVALID_REPORT_SIZE');
    const mime = file.mimetype;
    const bytes = file.buffer;
    const valid = mime === 'application/pdf' ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
      : mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : false;
    if (!valid) throw new BadRequestException('UNSUPPORTED_REPORT_FILE');
    return mime as 'application/pdf' | 'image/jpeg' | 'image/png';
  }

  private safeFilename(name: string, mime: string): string {
    const ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg';
    const stem = (name || 'report').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 130) || 'report';
    return `${stem}${ext}`;
  }

  private factsFromOcr(raw: unknown, ocr: string, lines?: OcrLine[]): ReportFacts {
    const text = ocr.slice(0, 50_000);
    const exact = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim().slice(0, 180);
      return trimmed && text.includes(trimmed) ? trimmed : null;
    };
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const tests: ReportFact[] = [];
    for (const candidate of Array.isArray(source.tests) ? source.tests.slice(0, 60) : []) {
      if (!candidate || typeof candidate !== 'object') continue;
      const item = candidate as Record<string, unknown>;
      const evidence = exact(item.evidence);
      if (!evidence) continue;
      const sourceLine = lines?.find((line) => line.text === evidence);
      if (lines && !sourceLine) continue;
      const name = typeof item.name === 'string' && evidence.includes(item.name.trim()) ? item.name.trim().slice(0, 100) : null;
      const value = typeof item.value === 'string' ? item.value.trim().slice(0, 60) : null;
      if (!name || !value) continue;
      const afterName = evidence.slice(evidence.indexOf(name) + name.length);
      const firstReading = afterName.match(/(?:^|[\s:=-])(\d+(?:\.\d+)?)(?=\s|$)/);
      const printedUnit = typeof item.unit === 'string' ? item.unit.trim() : '';
      const measuredPart = printedUnit && afterName.includes(printedUnit)
        ? afterName.slice(0, afterName.indexOf(printedUnit)) : afterName;
      const readingsBeforeUnit = measuredPart.match(/(?<![\p{L}\d])\d+(?:\.\d+)?(?![\p{L}\d])/gu) || [];
      if (firstReading?.[1] !== value || readingsBeforeUnit.length !== 1
        || /\b(?:or|maybe|unclear)\b|[?？]|\d\s*\/\s*\d/u.test(measuredPart)) continue;
      const optional = (field: unknown) => typeof field === 'string' && evidence!.includes(field.trim())
        ? field.trim().slice(0, 100) : null;
      tests.push({ name, value, unit: optional(item.unit), referenceRange: optional(item.referenceRange), evidence,
        ...(sourceLine ? { source: { page: sourceLine.page, confidence: sourceLine.confidence,
          bbox: sourceLine.bbox, rotationDegrees: sourceLine.rotationDegrees } } : {}) });
    }
    return { reportName: exact(source.reportName), reportDate: exact(source.reportDate), tests };
  }

  private factsFromTextLayer(text: string, lines?: OcrLine[]): ReportFacts {
    const tests: ReportFact[] = [];
    for (const line of text.split(/\r?\n/).slice(0, 250)) {
      const match = line.trim().match(/(?:^|\/\s*)(fasting blood glucose|blood glucose|fasting blood sugar|blood sugar|glucose|hba1c|hb a1c)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mg\s*\/\s*dL|%)\s*(?:\(?\s*(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:mg\s*\/\s*dL|%)?)\s*\)?)?\s*$/i);
      if (match) {
        const sourceLine = lines?.find((source) => source.text === line.trim());
        tests.push({ name: match[1], value: match[2], unit: match[3], referenceRange: match[4] || null,
          evidence: line.trim(), ...(sourceLine ? { source: { page: sourceLine.page, confidence: sourceLine.confidence,
            bbox: sourceLine.bbox, rotationDegrees: sourceLine.rotationDegrees } } : {}) });
      }
    }
    return { reportName: null, reportDate: null, tests };
  }

  private conflictingNames(lines: OcrLine[]): Set<string> {
    const values = new Map<string, Set<string>>();
    for (const line of lines) {
      const match = line.text.match(/^(.{3,60}?)\s+(\d+(?:\.\d+)?)(?=\s|$)/u);
      if (!match) continue;
      const key = match[1].toLowerCase().replace(/[^\p{L}\d]/gu, '');
      if (!values.has(key)) values.set(key, new Set());
      values.get(key)!.add(match[2]);
    }
    return new Set([...values].filter(([, readings]) => readings.size > 1).map(([name]) => name));
  }

  private async extract(file: UploadFile, mimeType: string): Promise<{ text: string; facts: ReportFacts;
    source: 'PDF_TEXT_LAYER' | 'INDEPENDENT_OCR_V1' | null; failed: boolean }> {
    let text = '';
    if (mimeType === 'application/pdf') {
      try {
        text = (await this.ocr.readPdfTextLayer(file.buffer))
          .split(/\r?\n/)
          .filter((line) => !/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/.test(line))
          .join('\n').trim().slice(0, 50_000);
      }
      catch { /* Scanned PDFs may have no text layer. */ }
    }
    let ocrLines: OcrLine[] | undefined;
    let hasUncertainRows = false;
    const source = text.trim() ? 'PDF_TEXT_LAYER' : 'INDEPENDENT_OCR_V1';
    if (!text.trim()) {
      try {
        const ocrResult = await this.ocr.read(file.buffer, mimeType);
        ocrLines = ocrResult.lines;
        hasUncertainRows = ocrResult.hasUncertainRows;
      }
      catch (error) {
        if (error instanceof Error && error.message === 'REPORT_OCR_BUSY') {
          throw new ServiceUnavailableException('REPORT_OCR_BUSY');
        }
        return { text: '', facts: { reportName: null, reportDate: null, tests: [] }, source: null, failed: true };
      }
      text = ocrLines.map((line) => line.text).join('\n').slice(0, 50_000);
    }
    if (!text.trim()) return { text: '', facts: { reportName: null, reportDate: null, tests: [] }, source: null, failed: false };
    const conflicts = ocrLines ? this.conflictingNames(ocrLines) : new Set<string>();
    const verifiedFacts = (facts: ReportFacts): ReportFacts => {
      const readings = new Map<string, Set<string>>();
      for (const test of facts.tests) {
        const key = test.name.toLowerCase().replace(/[^\p{L}\d]/gu, '');
        if (!readings.has(key)) readings.set(key, new Set());
        readings.get(key)!.add(test.value);
      }
      const tests = facts.tests.filter((test) => {
        const key = test.name.toLowerCase().replace(/[^\p{L}\d]/gu, '');
        return !conflicts.has(key) && readings.get(key)?.size === 1;
      });
      return { ...facts, tests, partialReading: hasUncertainRows,
        ...(tests.length ? { verification: source === 'INDEPENDENT_OCR_V1'
          ? 'INDEPENDENT_OCR_V1' as const : 'PDF_TEXT_LAYER_V1' as const } : {}) };
    };
    const fallback = () => verifiedFacts(this.factsFromTextLayer(text, ocrLines));
    const deterministic = fallback();
    if (source === 'INDEPENDENT_OCR_V1' && deterministic.tests.length) {
      return { text, facts: deterministic, source, failed: false };
    }
    try {
      if ((await this.ai.healthCheck()).status !== 'AVAILABLE') return { text, facts: fallback(), source, failed: false };
      const result = await this.ai.generate(
        `Extract report facts only from these source lines. Copy each test name, value, unit, reference range and complete evidence line exactly. Missing, conflicting or unclear items must be omitted. Do not diagnose or interpret.\n${text}`,
        { responseFormat: 'json', temperature: 0, timeoutMs: 120_000, telemetryLabel: 'PATIENT_REPORT_OCR',
          inlineData: source === 'PDF_TEXT_LAYER' ? [{ mimeType, data: file.buffer }] : [],
          jsonSchema: { type: 'OBJECT', properties: {
            rawText: { type: 'STRING' }, reportName: { type: 'STRING', nullable: true }, reportDate: { type: 'STRING', nullable: true },
            tests: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
              name: { type: 'STRING' }, value: { type: 'STRING' }, unit: { type: 'STRING', nullable: true },
              referenceRange: { type: 'STRING', nullable: true }, evidence: { type: 'STRING' },
            } } },
          }, required: ['rawText', 'tests'] },
        },
      );
      const json = result.json || {};
      // A text-layer PDF takes precedence over model OCR when available.
      const modelFacts = verifiedFacts(this.factsFromOcr(json, text, ocrLines));
      return { text, facts: modelFacts.tests.length ? modelFacts : fallback(), source, failed: false };
    } catch {
      return { text, facts: fallback(), source, failed: false };
    }
  }

  private async explain(facts: ReportFacts, language: string): Promise<string> {
    const hindi = language === 'hi';
    if (!facts.tests.length) return hindi
      ? 'रिपोर्ट साफ़ पढ़ी नहीं जा सकी। कृपया साफ़ फोटो लें या डॉक्टर से बात करें।'
      : 'The report could not be read clearly. Please upload a clearer copy or speak to a clinician.';
    const category = this.categoryFromFacts(facts);
    if (hindi) {
      if (category === 'BLOOD_GLUCOSE') return 'इस रिपोर्ट में खून की शुगर की जाँच लिखी है। नीचे लिखा नतीजा और लैब की सीमा असली रिपोर्ट से मिलाएँ। इसका मतलब डॉक्टर से पूछें।';
      if (category === 'HBA1C') return 'इस रिपोर्ट में HbA1c की जाँच लिखी है। यह पिछले कुछ महीनों की औसत शुगर से जुड़ी जाँच है। नतीजे का मतलब डॉक्टर से पूछें।';
      if (category === 'GLUCOSE_HBA1C') return 'इस रिपोर्ट में खून की शुगर और HbA1c की जाँचें लिखी हैं। नीचे दिए नतीजे असली रिपोर्ट से मिलाएँ और डॉक्टर से बात करें।';
      return 'रिपोर्ट में लिखी जाँचें और नतीजे नीचे दिखाए गए हैं। इनका मतलब डॉक्टर से पूछें।';
    }
    if (category === 'BLOOD_GLUCOSE') return 'This report lists a blood glucose test. Check the result and lab range against the original, and discuss it with a clinician.';
    if (category === 'HBA1C') return 'This report lists an HbA1c test, which relates to average blood sugar over recent months. Discuss the result with a clinician.';
    return 'The tests and results found in this report are shown below. Check the original and discuss them with a clinician.';
  }

  private categoryFromFacts(facts: ReportFacts): string | null {
    // Only evidence-backed test names classify a report. A title alone can be wrong.
    const names = facts.tests.map((test) => test.name).join(' ');
    const hba1c = /\b(?:hba1c|hb\s*a1c|glycated\s+hemoglobin|glycosylated\s+haemoglobin)\b/i.test(names);
    const glucose = /\b(?:glucose|blood\s+sugar|fasting\s+(?:blood\s+)?sugar|post\s*prandial\s+(?:blood\s+)?sugar)\b/i.test(names);
    if (hba1c && glucose) return 'GLUCOSE_HBA1C';
    if (hba1c) return 'HBA1C';
    if (glucose) return 'BLOOD_GLUCOSE';
    return null;
  }

  private isVerifiedReport(row: MedicalReport): boolean {
    return row.extractionStatus === 'EXTRACTED' && (
      row.mimeType === 'application/pdf'
        ? row.extractedFacts?.verification === 'PDF_TEXT_LAYER_V1'
          || row.extractedFacts?.verification === 'INDEPENDENT_OCR_V1'
        : row.extractedFacts?.verification === 'INDEPENDENT_OCR_V1');
  }

  async upload(sessionId: string, identity: HostIdentity, file: UploadFile | undefined, explicitConsent: boolean, language: string, correlationId: string) {
    const owner = await this.scope(sessionId, identity);
    if (!explicitConsent) throw new BadRequestException('REPORT_UPLOAD_CONSENT_REQUIRED');
    const mimeType = this.validateFile(file);
    const input = file!;
    if (mimeType === 'application/pdf') {
      try { await this.ocr.assertPdfPageLimit(input.buffer); }
      catch (error) {
        if (error instanceof Error && error.message === 'REPORT_PDF_PAGE_LIMIT') {
          throw new BadRequestException('REPORT_PDF_PAGE_LIMIT');
        }
        // An unreadable PDF is handled by the existing extraction failure path.
      }
    }
    const extracted = await this.extract(input, mimeType);
    const facts = extracted.facts;
    const status = extracted.failed ? 'EXTRACTION_FAILED'
      : !extracted.text.trim() || (extracted.source === 'INDEPENDENT_OCR_V1' && !facts.tests.length)
        ? 'UNREADABLE' : facts.tests.length ? 'EXTRACTED' : 'REVIEW_REQUIRED';
    const category = facts.partialReading ? null : this.categoryFromFacts(facts);
    let explanation = extracted.failed
      ? language === 'hi' ? 'रिपोर्ट पढ़ने की सेवा अभी काम नहीं कर रही। कृपया थोड़ी देर बाद फिर कोशिश करें।'
        : 'Report processing failed. Please try again later.'
      : extracted.source && facts.tests.length ? await this.explain(facts, language)
      : language === 'hi'
        ? 'इस फोटो या स्कैन से नतीजे भरोसे से नहीं पढ़े जा सकते। असली रिपोर्ट देखें और डॉक्टर से बात करें।'
        : 'Results cannot be read reliably from this image or scan. View the original and discuss it with a clinician.';
    if (facts.tests.length) explanation += language === 'hi'
      ? ' कुछ नतीजे छूट सकते हैं। असली रिपोर्ट से मिलाएँ।'
      : ' Some results may have been missed. Compare with the original report.';
    const report = await this.reports.manager.transaction(async (manager) => {
      if (category) await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${identity.tenantId}:${owner.subject}:${category}`]);
      const current = category ? await manager.findOne(MedicalReport, {
        where: { tenantId: identity.tenantId, patientRef: owner.subject, category, isCurrent: true },
      }) : null;
      return manager.save(MedicalReport, manager.create(MedicalReport, {
        tenantId: identity.tenantId, patientRef: owner.subject, consentArtifactId: owner.consentArtifactId,
        uploadConsentAt: new Date(), filename: this.safeFilename(input.originalname, mimeType), mimeType,
        checksum: createHash('sha256').update(input.buffer).digest('hex'), sourceFile: input.buffer,
        extractedText: extracted.text || null, extractedFacts: facts, explanation, extractionStatus: status,
        category, isCurrent: !current, replacementOf: current?.id || null,
      }));
    });
    await this.audit.logEvent({ tenantId: identity.tenantId, subjectAbhaRef: owner.subject, actingPrincipal: identity.externalId,
      correlationId, action: 'medical_report_uploaded', entityName: 'medical_report', entityId: report.id,
      details: { mimeType, extractionStatus: status, category, replacementPending: !!report.replacementOf } });
    return this.view(report, language);
  }

  private view(row: MedicalReport, language = 'hi') {
    const verified = this.isVerifiedReport(row);
    return { id: row.id, filename: row.filename, mimeType: row.mimeType,
      facts: verified ? row.extractedFacts : { reportName: null, reportDate: null, tests: [] },
      explanation: verified ? row.explanation : row.extractionStatus === 'EXTRACTED'
        ? language === 'hi' ? 'पुरानी रिपोर्ट के नतीजों का स्रोत सत्यापित नहीं है। असली रिपोर्ट देखें।'
          : 'Earlier extracted results have no verifiable source. View the original report.'
        : row.extractionStatus === 'EXTRACTION_FAILED'
        ? language === 'hi' ? 'रिपोर्ट पढ़ने की सेवा अभी काम नहीं कर रही। कृपया थोड़ी देर बाद फिर कोशिश करें।'
          : 'Report processing failed. Please try again later.' : language === 'hi'
        ? 'इस रिपोर्ट से नतीजे भरोसे से नहीं पढ़े जा सकते। असली रिपोर्ट देखें और डॉक्टर से बात करें।'
        : 'Results cannot be read reliably from this report. View the original and discuss it with a clinician.',
      extractionStatus: row.extractionStatus,
      readingCompleteness: verified ? row.extractedFacts?.partialReading ? 'POSSIBLY_PARTIAL' : 'UNCONFIRMED'
        : 'NOT_VERIFIED', createdAt: row.createdAt,
      category: verified ? row.category : null, isCurrent: row.isCurrent, replacementOf: row.replacementOf };
  }

  async confirmReplacement(sessionId: string, id: string, identity: HostIdentity, correlationId: string) {
    const owner = await this.scope(sessionId, identity);
    const report = await this.reports.manager.transaction(async (manager) => {
      const pending = await manager.findOne(MedicalReport, { where: { id, tenantId: identity.tenantId, patientRef: owner.subject } });
      if (!pending?.category || !pending.replacementOf || pending.isCurrent
        || !this.isVerifiedReport(pending) || pending.extractedFacts?.partialReading === true) {
        throw new BadRequestException('REPORT_REPLACEMENT_NOT_PENDING');
      }
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${identity.tenantId}:${owner.subject}:${pending.category}`]);
      const current = await manager.findOne(MedicalReport, { where: { id: pending.replacementOf, tenantId: identity.tenantId,
        patientRef: owner.subject, category: pending.category, isCurrent: true }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new BadRequestException('REPORT_REPLACEMENT_STALE');
      current.isCurrent = false;
      await manager.save(MedicalReport, current);
      pending.isCurrent = true;
      pending.replacementOf = null;
      return manager.save(MedicalReport, pending);
    });
    await this.audit.logEvent({ tenantId: identity.tenantId, subjectAbhaRef: owner.subject,
      actingPrincipal: identity.externalId, correlationId, action: 'medical_report_replaced',
      entityName: 'medical_report', entityId: report.id, details: { category: report.category } });
    return this.view(report, identity.preferredLanguage || 'hi');
  }

  async list(sessionId: string, identity: HostIdentity) {
    const owner = await this.scope(sessionId, identity);
    const rows = await this.reports.find({ where: { tenantId: identity.tenantId, patientRef: owner.subject },
      order: { createdAt: 'DESC' } });
    return rows.map((row) => this.view(row, identity.preferredLanguage || 'hi'));
  }

  private async owned(sessionId: string, id: string, identity: HostIdentity, source = false) {
    const owner = await this.scope(sessionId, identity);
    const query = this.reports.createQueryBuilder('r').where('r.id = :id AND r.tenantId = :tenantId AND r.patientRef = :patientRef',
      { id, tenantId: identity.tenantId, patientRef: owner.subject });
    if (source) query.addSelect('r.sourceFile');
    const row = await query.getOne();
    if (!row) throw new NotFoundException('REPORT_NOT_FOUND');
    return row;
  }

  async detail(sessionId: string, id: string, identity: HostIdentity) { return this.view(await this.owned(sessionId, id, identity), identity.preferredLanguage || 'hi'); }

  async source(sessionId: string, id: string, identity: HostIdentity, correlationId: string) {
    const row = await this.owned(sessionId, id, identity, true);
    await this.audit.logEvent({ tenantId: identity.tenantId, subjectAbhaRef: row.patientRef,
      actingPrincipal: identity.externalId, correlationId, action: 'medical_report_source_opened',
      entityName: 'medical_report', entityId: row.id });
    return { buffer: row.sourceFile, mimeType: row.mimeType, filename: row.filename };
  }

  async remove(sessionId: string, id: string, identity: HostIdentity, correlationId: string) {
    const owner = await this.scope(sessionId, identity);
    await this.reports.manager.transaction(async (manager) => {
      const row = await manager.findOne(MedicalReport, {
        where: { id, tenantId: identity.tenantId, patientRef: owner.subject },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('REPORT_NOT_FOUND');
      await manager.createQueryBuilder().update(ConversationTurn)
        .set({ inputText: null, outputText: null, reportId: null, selectedAgent: null,
          conversationRetentionGranted: false, status: 'REDACTED' })
        .where('"reportId" = :id AND "subjectRef" = :subject AND "sessionId" IN (SELECT id FROM sessions WHERE "tenantId" = :tenant AND "subjectAbhaRef" = :subject)',
          { id, subject: owner.subject, tenant: identity.tenantId })
        .execute();
      await manager.delete(MedicalReport, { id, tenantId: identity.tenantId, patientRef: owner.subject });
    });
    await this.audit.logEvent({ tenantId: identity.tenantId, subjectAbhaRef: owner.subject,
      actingPrincipal: identity.externalId, correlationId, action: 'medical_report_deleted',
      entityName: 'medical_report', entityId: id });
    return { deleted: true };
  }

  /** Called only after the existing turn safety gate, consent and idempotency checks. */
  async answerQuestion(sessionId: string, reportId: string, identity: HostIdentity, question: string) {
    const report = await this.owned(sessionId, reportId, identity);
    const facts = this.isVerifiedReport(report)
      ? report.extractedFacts as ReportFacts : { reportName: null, reportDate: null, tests: [] };
    const hindi = /[\u0900-\u097f]/u.test(question) || identity.preferredLanguage === 'hi'
      || /\b(kya|samjha|batao|hai|nahi|mujhe)\b/i.test(question);
    const unsupported = /diagnos|disease|treat|medicin|dose|tablet|stop|start|change|danger|normal|abnormal|मुझे क्या हुआ|इलाज|दवा|खुराक|सामान्य|असामान्य/i.test(question);
    let summary = unsupported
      ? (hindi ? 'मैं इस रिपोर्ट से बीमारी या इलाज तय नहीं कर सकता। कृपया डॉक्टर से बात करें।'
        : 'I cannot diagnose or decide treatment from this report. Please speak to a clinician.')
      : report.extractionStatus === 'EXTRACTED' && !this.isVerifiedReport(report)
        ? (hindi ? 'इस पुरानी रिपोर्ट के नतीजों का स्रोत सत्यापित नहीं है। असली रिपोर्ट देखें।'
          : 'The extracted results in this earlier report have no verifiable source. View the original.')
      : !facts.tests?.length
        ? (hindi ? 'यह रिपोर्ट साफ़ पढ़ी नहीं जा सकी। कृपया साफ़ प्रति दें या डॉक्टर से बात करें।'
          : 'This report could not be read clearly. Please provide a clearer copy or speak to a clinician.')
        : (hindi ? 'इस रिपोर्ट में लिखे जाँच के नाम और नतीजे नीचे हैं। इनका मतलब डॉक्टर से पूछें।'
          : 'These are the test names and results visible in this report. Ask a clinician what they mean for you.');
    if (!unsupported && facts.tests?.length) summary += hindi
      ? ' कुछ नतीजे छूट सकते हैं। असली रिपोर्ट से मिलाएँ।'
      : ' Some results may have been missed. Compare with the original report.';
    return { responseType: 'text', content: { summary, en: summary, hi: summary,
      sections: unsupported ? [] : (facts.tests || []).map((fact) => ({ body: `${fact.name}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}${fact.referenceRange ? ` (${fact.referenceRange})` : ''}` })),
      report_id: report.id }, intent: 'REPORT_EDUCATION', selectedAgent: 'report-reader', safetyStatus: 'SAFE' };
  }
}
