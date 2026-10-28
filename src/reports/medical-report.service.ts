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
  flag?: string;
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
      // Interpretation prose is not a measured result, even if it mentions a threshold.
      if (/^(?:interpretation|comments?|notes?)\b/i.test(evidence)
        || /[<>]/.test(afterName)
        || !/^\s*[:=-]?\s*\d/u.test(afterName)) continue;
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
    const sourceLines = text.split(/\r?\n/).slice(0, 250).map((line) => line.trim());
    const interpretation = sourceLines.findIndex((line) => /^(?:interpretation|comments?|notes?)\b/i.test(line));
    const interpretationBox = lines?.find((line) => /^(?:interpretation|comments?|notes?)\b/i.test(line.text));
    const aligned: OcrLine[] = [];
    if (lines?.length) {
      const sorted = [...lines].sort((a, b) => a.page - b.page
        || (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1) || a.bbox.x0 - b.bbox.x0);
      const groups: OcrLine[][] = [];
      for (const line of sorted) {
        const previous = groups[groups.length - 1];
        const anchor = previous?.[0];
        const centre = (line.bbox.y0 + line.bbox.y1) / 2;
        const anchorCentre = anchor ? (anchor.bbox.y0 + anchor.bbox.y1) / 2 : 0;
        const tolerance = anchor ? Math.min(anchor.bbox.y1 - anchor.bbox.y0,
          line.bbox.y1 - line.bbox.y0) * 0.45 : 0;
        if (anchor && anchor.page === line.page && Math.abs(centre - anchorCentre) <= tolerance) previous.push(line);
        else groups.push([line]);
      }
      for (const group of groups.filter((items) => items.length > 1)) {
        const ordered = group.sort((a, b) => a.bbox.x0 - b.bbox.x0);
        if (interpretationBox && (ordered[0].page > interpretationBox.page
          || ordered[0].page === interpretationBox.page && ordered[0].bbox.y0 >= interpretationBox.bbox.y0)) continue;
        const joined = ordered.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
        if (joined.length > 160 || !ordered.some((line) => !/\d/.test(line.text))) continue;
        aligned.push({ text: joined, page: ordered[0].page,
          confidence: Math.min(...ordered.map((line) => line.confidence)),
          bbox: { x0: Math.min(...ordered.map((line) => line.bbox.x0)),
            y0: Math.min(...ordered.map((line) => line.bbox.y0)),
            x1: Math.max(...ordered.map((line) => line.bbox.x1)),
            y1: Math.max(...ordered.map((line) => line.bbox.y1)) },
          rotationDegrees: ordered[0].rotationDegrees });
      }
    }
    const resultLines = [...sourceLines.slice(0, interpretation < 0 ? undefined : interpretation),
      ...aligned.map((line) => line.text)];
    const evidenceLines = [...(lines || []), ...aligned];
    // A complete OCR line can represent an unfamiliar laboratory test. The row
    // grammar, rather than a list of test names, decides whether it is evidence.
    const units = '(?:mg\\s*\\/\\s*dL|g\\s*\\/\\s*dL|g\\s*\\/\\s*L|mg\\s*\\/\\s*L|mmol\\s*\\/\\s*L|mEq\\s*\\/\\s*L|IU\\s*\\/\\s*L|U\\s*\\/\\s*L|uIU\\s*\\/\\s*mL|mIU\\s*\\/\\s*L|ng\\s*\\/\\s*mL|pg\\s*\\/\\s*mL|ng\\s*\\/\\s*dL|pg\\s*\\/\\s*dL|mcg\\s*\\/\\s*dL|µg\\s*\\/\\s*dL|million\\s*\\/\\s*(?:uL|µL)|cells\\s*\\/\\s*(?:uL|µL|hpf)|\\/\\s*(?:uL|µL|hpf)|x?10\\^?\\d\\s*\\/\\s*(?:uL|µL)|fL|pg|%|mm\\s*\\/\\s*hr)';
    const numericTail = new RegExp(`^\\s*(${units})?\\s*((?:very\\s+)?high|low|normal|H|L)?\\s*(\\d+(?:\\.\\d+)?\\s*[-–]\\s*\\d+(?:\\.\\d+)?)?\\s*(${units})?\\s*$`, 'i');
    const blockedLabel = /^(?:age|sex|gender|pid|patient|sample|collected|reported|date|time|reference|ref\.?\s*by|method|page|interpretation|comments?|notes?|probable\s+causes?|hexokinase|enzymatic|photometric)\b/i;
    const sourceFor = (evidence: string) => {
      const line = evidenceLines.find((item) => item.text === evidence);
      return line ? { page: line.page, confidence: line.confidence, bbox: line.bbox,
        rotationDegrees: line.rotationDegrees } : undefined;
    };
    const parseRow = (evidence: string): ReportFact | null => {
      if (evidence.length > 160 || blockedLabel.test(evidence) || /[<>?।]/u.test(evidence)) return null;
      const candidate = evidence.match(/^([\p{L}][\p{L}\p{N} ,()./+\-]{1,78}?)\s*[:\t ]+\s*(-?\d+(?:\.\d+)?)(.*)$/u);
      if (candidate) {
        const name = candidate[1].replace(/[,.:\s-]+$/u, '').trim();
        const tail = candidate[3].match(numericTail);
        if (!name || blockedLabel.test(name) || !tail || (!tail[1] && !tail[3] && !tail[4])) return null;
        const unit = (tail[1] || tail[4] || '').replace(/\s+/g, '') || null;
        if (tail[1] && tail[4] && tail[1].replace(/\s+/g, '').toLowerCase() !== tail[4].replace(/\s+/g, '').toLowerCase()) return null;
        return { name, value: candidate[2], unit,
          referenceRange: tail[3] ? `${tail[3]}${tail[4] ? ` ${tail[4]}` : ''}` : null, evidence,
          ...(tail[2] ? { flag: tail[2] } : {}),
          ...(sourceFor(evidence) ? { source: sourceFor(evidence) } : {}) };
      }
      const qualitative = evidence.match(/^([\p{L}][\p{L}\p{N} ,()./+\-]{1,78}?)\s*[:\t ]+\s*(non[- ]reactive|positive|negative|reactive|trace|present|absent)(?:\s+(?:reference\s*[:=]?\s*)?(non[- ]reactive|positive|negative|reactive|trace|present|absent))?\s*$/iu);
      if (!qualitative || blockedLabel.test(qualitative[1]) || (!qualitative[3] && !/\b(?:urine|protein|ketone|nitrite|glucose)\b/i.test(qualitative[1]))) return null;
      return { name: qualitative[1].trim(), value: qualitative[2], unit: null,
        referenceRange: qualitative[3] || null, evidence,
        ...(sourceFor(evidence) ? { source: sourceFor(evidence) } : {}) };
    };
    for (const line of resultLines) {
      const row = parseRow(line);
      if (row) tests.push(row);
    }
    const namePattern = '(?:glucose,?\\s*fasting|fasting\\s+(?:blood\\s+)?(?:glucose|sugar)|random\\s+(?:blood\\s+)?(?:glucose|sugar)|rbs|blood\\s+glucose|blood\\s+sugar|glucose|hba1c|hb\\s*a1c)';
    const row = new RegExp(`^(${namePattern})\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(mg\\s*\\/\\s*dL|%)\\s*(?:\\(?\\s*(\\d+(?:\\.\\d+)?\\s*[-–]\\s*\\d+(?:\\.\\d+)?\\s*(?:mg\\s*\\/\\s*dL|%)?)\\s*\\)?)?$`, 'i');
    for (const line of resultLines) {
      const match = line.match(row) || line.match(new RegExp(`^(?:[^/]+/\\s*)(${namePattern})\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(mg\\s*\\/\\s*dL|%)\\s*(?:\\(?\\s*(\\d+(?:\\.\\d+)?\\s*[-–]\\s*\\d+(?:\\.\\d+)?\\s*(?:mg\\s*\\/\\s*dL|%)?)\\s*\\)?)?$`, 'i'));
      if (match) {
        const sourceLine = lines?.find((source) => source.text === line);
        tests.push({ name: match[1], value: match[2], unit: match[3], referenceRange: match[4] || null,
          evidence: line, ...(sourceLine ? { source: { page: sourceLine.page, confidence: sourceLine.confidence,
            bbox: sourceLine.bbox, rotationDegrees: sourceLine.rotationDegrees } } : {}) });
      }
    }
    // Some text PDFs place the analyte, assay method, and numeric columns on separate lines.
    // Accept only a standalone test label followed by a strict numeric row before interpretation.
    for (let index = 0; index < resultLines.length - 1; index++) {
      const name = resultLines[index].match(/^([\p{L}][\p{L}\p{N} ,()./+\-]{1,78})$/u)?.[1]?.trim();
      if (name && blockedLabel.test(name)) continue;
      if (!name) continue;
      const next = resultLines[index + 1];
      const valueLine = /^(?:hexokinase|enzymatic|photometric)$/i.test(next)
        ? resultLines[index + 2] : next;
      const result = valueLine?.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s+(${units})\\s+(\\d+(?:\\.\\d+)?\\s*[-–]\\s*\\d+(?:\\.\\d+)?(?:\\s*${units})?)$`, 'i'));
      if (!result) continue;
      tests.push({ name, value: result[1], unit: result[2], referenceRange: result[3],
        evidence: `${name}\n${valueLine}` });
    }
    const reportDate = resultLines.find((line) => /^(?:report\s+)?date\s*[:\t ]+(?:\d{1,2}\/[A-Za-z]{3}\/\d{4}|\d{4}-\d{2}-\d{2})$/i.test(line))
      ?.match(/\d{1,2}\/[A-Za-z]{3}\/\d{4}|\d{4}-\d{2}-\d{2}/)?.[0] || null;
    const reportName = resultLines.find((line) => /^(?:complete blood count|cbc|kidney function test|renal function test|liver function test|lipid profile|thyroid profile|urine routine|blood sugar|fasting blood sugar|random blood sugar|hba1c report)$/i.test(line)) || null;
    const unique = tests.filter((test, index) => tests.findIndex((other) =>
      other.name.toLowerCase() === test.name.toLowerCase() && other.value === test.value) === index);
    unique.sort((a, b) => a.source && b.source
      ? a.source.page - b.source.page || a.source.bbox.y0 - b.source.bbox.y0
      : resultLines.findIndex((line) => line === a.evidence) - resultLines.findIndex((line) => line === b.evidence));
    return { reportName, reportDate, tests: unique };
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
    const partialTableFacts: ReportFact[] = (ocrLines || []).filter((line) => line.measurement).map((line) => ({
      ...line.measurement!, evidence: line.text,
      source: { page: line.page, confidence: line.confidence, bbox: line.bbox,
        rotationDegrees: line.rotationDegrees },
    }));
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
      }).filter((test, index, all) => all.findIndex((other) => other.name === test.name && other.value === test.value) === index);
      return { ...facts, tests, partialReading: hasUncertainRows,
        ...(tests.length ? { verification: source === 'INDEPENDENT_OCR_V1'
          ? 'INDEPENDENT_OCR_V1' as const : 'PDF_TEXT_LAYER_V1' as const } : {}) };
    };
    const fallback = () => {
      const parsed = this.factsFromTextLayer(text, ocrLines);
      return verifiedFacts({ ...parsed, tests: [...parsed.tests, ...partialTableFacts] });
    };
    const deterministic = fallback();
    if (deterministic.tests.length) {
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

  private rangePosition(test: ReportFact): 'below' | 'within' | 'above' | null {
    if (!/^-?\d+(?:\.\d+)?$/.test(test.value)) return null;
    const range = test.referenceRange?.match(/^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?:\s+(.+))?\s*$/);
    if (!range || Number(range[1]) >= Number(range[2])) return null;
    if (range[3] && (!test.unit || range[3].replace(/\s/g, '').toLowerCase()
      !== test.unit.replace(/\s/g, '').toLowerCase())) return null;
    const value = Number(test.value);
    return value < Number(range[1]) ? 'below' : value > Number(range[2]) ? 'above' : 'within';
  }

  private reportType(facts: ReportFacts): string {
    const names = facts.tests.map((test) => test.name.toLowerCase()).join(' ');
    if (/\b(?:hba1c|glycated hemoglobin)\b/.test(names) && /\b(?:glucose|sugar|rbs)\b/.test(names)) return 'GLUCOSE_HBA1C';
    if (/\b(?:hba1c|glycated hemoglobin)\b/.test(names)) return 'HBA1C';
    if (/\b(?:glucose|sugar|rbs)\b/.test(names) && !/\burine\b/.test(names)) return 'BLOOD_GLUCOSE';
    const bloodCountMarkers = [/hemoglobin/, /platelet/, /\bwbc\b/, /\brbc\b/]
      .filter((pattern) => pattern.test(names)).length;
    if (/\b(?:cbc|complete blood count)\b/i.test(facts.reportName || '') || bloodCountMarkers >= 2) return 'CBC';
    if (/\b(?:tsh|t3|t4|thyroid)\b/.test(names)) return 'THYROID';
    if (/\b(?:creatinine|urea|egfr)\b/.test(names)) return 'KIDNEY';
    if (/\b(?:alt|ast|bilirubin|albumin)\b/.test(names)) return 'LIVER';
    if (/\b(?:cholesterol|hdl|ldl|triglycerides)\b/.test(names)) return 'LIPID';
    if (/\b(?:urine|protein|ketone|nitrite)\b/.test(names)) return 'URINE';
    return 'OTHER_LAB';
  }

  private reportDateValue(value: string | null): number | null {
    if (!value) return null;
    const indian = value.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = indian ? months.indexOf(indian[2].toLowerCase()) : -1;
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!iso && (!indian || month < 0)) return null;
    const year = Number(iso?.[1] || indian?.[3]);
    const monthNumber = iso ? Number(iso[2]) - 1 : month;
    const day = Number(iso?.[3] || indian?.[1]);
    const date = new Date(Date.UTC(year, monthNumber, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === monthNumber
      && date.getUTCDate() === day ? date.getTime() : null;
  }

  private testMeaning(name: string, hindi: boolean): string {
    const key = name.toLowerCase();
    const meanings: Array<[RegExp, string, string]> = [
      [/\burine\b/, 'यह पेशाब के नमूने की जाँच है।', 'This tests a urine sample.'],
      [/\b(?:hba1c|glycated hemoglobin)\b/, 'यह पिछले लगभग 3 महीनों की औसत शुगर का संकेत देती है।', 'This reflects average blood sugar over about three months.'],
      [/fasting/, 'यह खाली पेट खून में शुगर की मात्रा बताती है।', 'This measures blood sugar after fasting.'],
      [/\b(?:random|rbs)\b/, 'यह किसी भी समय खून में शुगर की मात्रा बताती है।', 'This measures blood sugar at any time of day.'],
      [/\b(?:glucose|sugar)\b/, 'यह खून में शुगर की मात्रा बताती है।', 'This measures blood sugar.'],
      [/hemoglobin/, 'यह खून के उस हिस्से को मापती है जो शरीर में ऑक्सीजन पहुँचाता है।', 'This measures the blood protein that carries oxygen.'],
      [/\b(?:wbc|white blood cell)/, 'यह बीमारी से लड़ने वाली सफेद रक्त कोशिकाएँ गिनती है।', 'This counts white blood cells that help fight illness.'],
      [/platelet/, 'यह खून जमने में मदद करने वाली कोशिकाएँ गिनती है।', 'This counts platelets that help blood clot.'],
      [/\b(?:creatinine|urea|egfr)\b/, 'यह किडनी के काम से जुड़ी जाँच है।', 'This test relates to kidney function.'],
      [/\b(?:alt|ast|bilirubin|albumin)\b/, 'यह लिवर से जुड़ी जाँच है।', 'This test relates to the liver.'],
      [/\b(?:tsh|t3|t4|thyroid)\b/, 'यह थायरॉयड ग्रंथि से जुड़ी जाँच है।', 'This test relates to the thyroid gland.'],
      [/\b(?:cholesterol|hdl|ldl|triglycerides)\b/, 'यह खून में चर्बी से जुड़ी जाँच है।', 'This measures a type of fat in the blood.'],
    ];
    const match = meanings.find(([pattern]) => pattern.test(key));
    return match ? match[hindi ? 1 : 2] : '';
  }

  private explain(facts: ReportFacts, language: string): string {
    const hindi = language === 'hi';
    if (!facts.tests.length) return hindi
      ? 'रिपोर्ट साफ़ पढ़ी नहीं जा सकी। कृपया साफ़ फोटो लें या डॉक्टर से बात करें।'
      : 'The report could not be read clearly. Please upload a clearer copy or speak to a clinician.';
    const outOfRange = facts.tests.filter((test) => ['above', 'below'].includes(this.rangePosition(test) || ''));
    const compared = facts.tests.filter((test) => this.rangePosition(test));
    const ranked = [...facts.tests].sort((a, b) => {
      const rank = (test: ReportFact) => ['above', 'below'].includes(this.rangePosition(test) || '') ? 0
        : this.rangePosition(test) === 'within' ? 1 : 2;
      return rank(a) - rank(b);
    });
    const paragraphs: string[] = [];
    if (facts.tests.length > 1) paragraphs.push(hindi
      ? `रिपोर्ट में ${facts.tests.length} नतीजे पढ़े गए। ${outOfRange.length ? `${outOfRange.length} लैब की छपी सीमा से बाहर हैं।` : compared.length ? 'तुलना किए गए नतीजे छपी सीमा के भीतर हैं।' : 'सीमाएँ साफ़ नहीं पढ़ी गईं, इसलिए तुलना नहीं हुई।'}`
      : `${facts.tests.length} results were read. ${outOfRange.length ? `${outOfRange.length} are outside the printed lab range.` : compared.length ? 'Compared results are within their printed ranges.' : 'Ranges were not read clearly enough for comparison.'}`);
    for (const test of ranked.slice(0, 6)) {
      const relative = this.rangePosition(test);
      const reading = `${test.value}${test.unit === '%' ? '%' : test.unit ? ` ${test.unit}` : ''}`;
      const printedRange = test.referenceRange
        ? `${test.referenceRange.replace(/\s*[-–]\s*/g, '–')}${test.unit
          && !/[A-Za-z%µ]/.test(test.referenceRange) ? ` ${test.unit}` : ''}` : '';
      const meaning = this.testMeaning(test.name, hindi);
      const qualitative = /^(?:positive|negative|reactive|non[- ]reactive|trace|present|absent)$/i.test(test.value);
      if (hindi) {
        const comparison = relative ? ` इस लैब की छपी सीमा ${printedRange} है। आपका नतीजा ${relative === 'above' ? 'इससे ज्यादा है' : relative === 'below' ? 'इससे कम है' : 'इस सीमा के भीतर है'}।`
          : qualitative && test.referenceRange ? ` छपी संदर्भ श्रेणी ${test.referenceRange} है; इसे उसी के साथ देखें।`
            : ' लैब की सीमा भरोसे से नहीं पढ़ी गई। इसलिए इसे सामान्य, ज्यादा या कम नहीं कह सकते।';
        paragraphs.push(`${test.name}: ${meaning ? `${meaning} ` : ''}रिपोर्ट में ${reading} लिखा है।${comparison}`);
      } else {
        const comparison = relative ? ` This lab's printed range is ${printedRange}. Your result is ${relative} that range.`
          : qualitative && test.referenceRange ? ` The printed reference is ${test.referenceRange}; compare the words on the original report.`
            : ' The lab range was not read reliably, so this result cannot be called normal, high, or low.';
        paragraphs.push(`${test.name}: ${meaning ? `${meaning} ` : ''}The reported result is ${reading}.${comparison}`);
      }
    }
    if (facts.tests.length > 6) paragraphs.push(hindi
      ? `और ${facts.tests.length - 6} नतीजे भी पढ़े गए हैं। उनके लिए अलग से पूछें।`
      : `${facts.tests.length - 6} more results were read. Ask about a specific one for details.`);
    paragraphs.push(hindi
      ? `${outOfRange.length ? 'सीमा से बाहर नतीजों पर डॉक्टर से बात करें। ' : 'एक रिपोर्ट से बीमारी की पुष्टि या खारिज नहीं होती। '}दवा या खुराक डॉक्टर की सलाह के बिना न बदलें। असली रिपोर्ट से मिलाएँ।`
      : `${outOfRange.length ? 'Discuss out-of-range results with a clinician. ' : 'One report cannot confirm or rule out a condition. '}Do not change medicines or doses without medical advice. Compare with the original report.`);
    return paragraphs.join('\n\n');
  }

  private explanationForFacts(facts: ReportFacts, language: string): string {
    return this.explain(facts, language) + (language === 'hi'
      ? '\n\nकुछ नतीजे छूट सकते हैं।' : '\n\nSome results may have been missed.');
  }

  private categoryFromFacts(facts: ReportFacts): string | null {
    // Only evidence-backed test names classify a report. A title alone can be wrong.
    const names = facts.tests.map((test) => test.name).join(' ');
    const hba1c = /\b(?:hba1c|hb\s*a1c|glycated\s+hemoglobin|glycosylated\s+haemoglobin)\b/i.test(names);
    const glucose = /\b(?:glucose|rbs|blood\s+sugar|fasting\s+(?:blood\s+)?sugar|post\s*prandial\s+(?:blood\s+)?sugar)\b/i.test(names);
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
      : extracted.source && facts.tests.length ? this.explanationForFacts(facts, language)
      : language === 'hi'
        ? 'इस फोटो या स्कैन से नतीजे भरोसे से नहीं पढ़े जा सकते। असली रिपोर्ट देखें और डॉक्टर से बात करें।'
        : 'Results cannot be read reliably from this image or scan. View the original and discuss it with a clinician.';
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
      reportType: verified ? this.reportType(row.extractedFacts as ReportFacts) : null,
      explanation: verified ? this.explanationForFacts(row.extractedFacts as ReportFacts, language) : row.extractionStatus === 'EXTRACTED'
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
    const facts: ReportFacts = this.isVerifiedReport(report)
      ? report.extractedFacts as ReportFacts : { reportName: null, reportDate: null, tests: [] };
    const hindi = /[\u0900-\u097f]/u.test(question) || identity.preferredLanguage === 'hi'
      || /\b(kya|samjha|batao|hai|hain|nahi|mujhe|mera|meri|kaun|kitna|pichli|dikhana|chahiye)\b/i.test(question);
    const unsupported = /diagnos|disease|treat|medicin|dose|tablet|stop|start|change|danger|मुझे क्या हुआ|इलाज|दवा|खुराक/i.test(question);
    let focusedFacts = facts;
    let directAnswer: string | null = null;
    if (!unsupported && facts.tests.length) {
      if (/\b(?:compare|difference|previous|earlier|pichli|pichle|farq|antar)\b|पिछल|पहले|फर्क|अंतर/i.test(question)) {
        const currentDate = this.reportDateValue(facts.reportDate);
        const owner = `mobile-user:${identity.mobileUserId}`;
        const previous = currentDate === null ? [] : (await this.reports.find({
          where: { tenantId: identity.tenantId, patientRef: owner }, order: { createdAt: 'DESC' },
        })).filter((row) => row.tenantId === identity.tenantId && row.patientRef === owner
          && row.id !== report.id && this.isVerifiedReport(row)
          && (this.reportDateValue((row.extractedFacts as ReportFacts).reportDate) ?? Infinity) < currentDate)
          .sort((a, b) => (this.reportDateValue((b.extractedFacts as ReportFacts).reportDate) || 0)
            - (this.reportDateValue((a.extractedFacts as ReportFacts).reportDate) || 0));
        const key = (test: ReportFact) => test.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const nearest = previous.find((row) => facts.tests.some((current) =>
          (row.extractedFacts as ReportFacts).tests.some((test) => key(test) === key(current)
            && test.unit?.toLowerCase() === current.unit?.toLowerCase())));
        const matches = (nearest ? [nearest] : []).flatMap((row) => facts.tests.flatMap((current) => {
          const older = (row.extractedFacts as ReportFacts).tests.find((test) => key(test) === key(current)
            && test.unit?.toLowerCase() === current.unit?.toLowerCase()
            && /^-?\d+(?:\.\d+)?$/.test(test.value) && /^-?\d+(?:\.\d+)?$/.test(current.value));
          return older ? [{ current, older, date: (row.extractedFacts as ReportFacts).reportDate }] : [];
        })).slice(0, 6);
        directAnswer = matches.length ? matches.map(({ current, older, date }) => hindi
          ? `${current.name}: ${date} को ${older.value}${older.unit ? ` ${older.unit}` : ''}; ${facts.reportDate} को ${current.value}${current.unit ? ` ${current.unit}` : ''}।`
          : `${current.name}: ${older.value}${older.unit ? ` ${older.unit}` : ''} on ${date}; ${current.value}${current.unit ? ` ${current.unit}` : ''} on ${facts.reportDate}.`).join('\n')
          + (hindi ? '\nयह केवल एक ही जाँच की दो रिपोर्टों का अंतर है; मतलब डॉक्टर से पूछें।'
            : '\nThis compares the same test in two dated reports; discuss its meaning with a clinician.')
          : hindi ? 'भरोसे से तुलना करने के लिए अलग तारीखों की दो सत्यापित रिपोर्टों में वही जाँच और इकाई चाहिए।'
            : 'Comparison needs the same test and unit in two verified reports with different printed dates.';
      } else {
        const aliases: Array<[RegExp, RegExp]> = [
          [/hemoglobin|haemoglobin|हीमोग्लोबिन|हिमोग्लोबिन/i, /hemoglobin|haemoglobin/i],
          [/\b(?:tsh|t3|t4|thyroid)\b|थायरॉयड/i, /\b(?:tsh|t3|t4|thyroid)\b/i],
          [/\b(?:creatinine|urea|kidney)\b|किडनी/i, /\b(?:creatinine|urea|egfr)\b/i],
          [/\b(?:alt|ast|bilirubin|liver)\b|लिवर/i, /\b(?:alt|ast|bilirubin|albumin)\b/i],
          [/\b(?:cholesterol|hdl|ldl|triglycerides|lipid)\b|कोलेस्ट्रॉल/i, /\b(?:cholesterol|hdl|ldl|triglycerides)\b/i],
        ];
        const requested = aliases.find(([pattern]) => pattern.test(question))?.[1];
        const matches = requested ? facts.tests.filter((test) => requested.test(test.name))
          : facts.tests.filter((test) => test.name.length >= 3 && question.toLowerCase().includes(test.name.toLowerCase()));
        if (matches.length) focusedFacts = { ...facts, tests: matches };
        else if (requested) directAnswer = hindi
          ? 'इस चुनी हुई रिपोर्ट में यह जाँच सत्यापित नतीजों में नहीं मिली। असली रिपोर्ट देखें।'
          : 'This test was not found among the verified results in the selected report. Check the original.';
        if (/\b(?:high|above|elevated)\b|ज्यादा|बढ़|ऊपर/i.test(question)) {
          focusedFacts = { ...focusedFacts, tests: focusedFacts.tests.filter((test) => this.rangePosition(test) === 'above') };
          if (!focusedFacts.tests.length) directAnswer = hindi
            ? 'इस रिपोर्ट में कोई सत्यापित नतीजा अपनी छपी सीमा से ऊपर नहीं मिला। जिनकी सीमा साफ़ नहीं पढ़ी गई, उनकी तुलना नहीं हुई।'
            : 'No verified result was found above its printed range. Results without a clear range were not compared.';
        } else if (/\b(?:doctor|clinician|dikhana)\b|डॉक्टर|दिखाना/i.test(question)) {
          const outside = facts.tests.some((test) => ['above', 'below'].includes(this.rangePosition(test) || ''));
          directAnswer = outside
            ? hindi ? 'हाँ, इस रिपोर्ट में कुछ नतीजे लैब की छपी सीमा से बाहर हैं। असली रिपोर्ट लेकर डॉक्टर से बात करें।'
              : 'Yes. Some results are outside the printed lab range. Take the original report to a clinician.'
            : facts.tests.some((test) => this.rangePosition(test))
              ? hindi ? 'तुलना किए गए नतीजे छपी सीमा के भीतर हैं, लेकिन कुछ सीमाएँ छूट सकती हैं। चिंता या लक्षण हों तो डॉक्टर को रिपोर्ट दिखाएँ।'
                : 'Compared results are within their printed ranges, but some ranges may be missing. If you have symptoms or concerns, show the report to a clinician.'
              : hindi ? 'लैब की छपी सीमाएँ साफ़ नहीं पढ़ी गईं, इसलिए तुलना नहीं कर सकता। असली रिपोर्ट डॉक्टर को दिखाएँ।'
                : 'The printed ranges were not read clearly, so I cannot compare results. Show the original report to a clinician.';
        }
      }
    }
    let summary = unsupported
      ? (hindi ? 'मैं इस रिपोर्ट से बीमारी या इलाज तय नहीं कर सकता। कृपया डॉक्टर से बात करें।'
        : 'I cannot diagnose or decide treatment from this report. Please speak to a clinician.')
      : report.extractionStatus === 'EXTRACTED' && !this.isVerifiedReport(report)
        ? (hindi ? 'इस पुरानी रिपोर्ट के नतीजों का स्रोत सत्यापित नहीं है। असली रिपोर्ट देखें।'
          : 'The extracted results in this earlier report have no verifiable source. View the original.')
      : !facts.tests?.length
        ? (hindi ? 'यह रिपोर्ट साफ़ पढ़ी नहीं जा सकी। कृपया साफ़ प्रति दें या डॉक्टर से बात करें।'
          : 'This report could not be read clearly. Please provide a clearer copy or speak to a clinician.')
        : directAnswer || await this.explain(focusedFacts, hindi ? 'hi' : 'en');
    if (!unsupported && facts.tests?.length && facts.partialReading) summary += hindi
      ? '\n\nरिपोर्ट का कुछ हिस्सा छूटा हो सकता है। असली रिपोर्ट देखें।'
      : '\n\nSome results may have been missed. Check the original report.';
    return { responseType: 'text', content: { summary, en: summary, hi: summary,
      sections: [],
      report_id: report.id }, intent: 'REPORT_EDUCATION', selectedAgent: 'report-reader', safetyStatus: 'SAFE' };
  }
}
