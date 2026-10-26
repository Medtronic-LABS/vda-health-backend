import { readFileSync } from 'fs';
import { join } from 'path';
import { MedicalReportService } from './medical-report.service';
import { ReportOcrService } from './report-ocr.service';

jest.setTimeout(120_000);

const identity = { authType: 'MOBILE', mobileUserId: 'synthetic-patient', tenantId: 'synthetic-tenant',
  externalId: 'synthetic-user', preferredLanguage: 'hi' } as any;
const session = { id: 'synthetic-session', tenantId: identity.tenantId, externalId: identity.externalId,
  subjectAbhaRef: 'mobile-user:synthetic-patient', consentArtifactId: 'synthetic-consent', status: 'ACTIVE',
  idleExpiresAt: new Date(Date.now() + 600_000), absoluteExpiresAt: new Date(Date.now() + 600_000) };

function service() {
  const manager = { query: jest.fn(), findOne: jest.fn().mockResolvedValue(null), create: jest.fn((_entity, value) => value),
    save: jest.fn(async (_entity, value) => ({ ...value, id: 'synthetic-report', createdAt: new Date() })) };
  const reports = { manager: { transaction: jest.fn(async (fn) => fn(manager)) } };
  return new MedicalReportService(reports as any, { findOne: jest.fn().mockResolvedValue(session) } as any,
    { validateConsent: jest.fn() } as any, new ReportOcrService(),
    { logEvent: jest.fn() } as any, { healthCheck: jest.fn().mockResolvedValue({ status: 'UNAVAILABLE' }) } as any);
}

async function upload(name: string) {
  const mimetype = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const buffer = readFileSync(join(__dirname, '__fixtures__', name));
  return service().upload('synthetic-session', identity, { buffer, originalname: name, mimetype }, true, 'hi', 'synthetic-correlation');
}

describe('local OCR with synthetic reports', () => {
  it('accepts only a clearly read glucose table value and omits an uncertain range', () => {
    const ocr = new ReportOcrService();
    const text = 'GLUCOSE, FASTING, 245.00 Very High 70.00 - 100.00 mg/dL';
    const words = ['GLUCOSE,', 'FASTING,', '245.00', 'Very', 'High', '70.00', '-', '100.00', 'mg/dL']
      .map((word, index) => ({ text: word, confidence: index === 5 || index === 6 ? 71 : 95 }));
    expect((ocr as any).partialTableMeasurement({ text, words })).toEqual({
      evidence: 'GLUCOSE, FASTING, 245.00', name: 'GLUCOSE, FASTING',
      value: '245.00', unit: 'mg/dL', referenceRange: null,
    });
    words[2].confidence = 70;
    expect((ocr as any).partialTableMeasurement({ text, words })).toBeNull();
    words[2].confidence = 95;
    expect((ocr as any).partialTableMeasurement({ text: text.replace('245.00', '245.00 or 425.00'), words })).toBeNull();
  });

  it('does not treat printable bytes in a malformed PDF as a verified text layer', async () => {
    const malformed = Buffer.from('%PDF- Glucose 110 mg/dL 70-99 mg/dL');
    await expect(new ReportOcrService().readPdfTextLayer(malformed)).rejects.toThrow();
  });

  it('rejects a PDF beyond the five-page report limit before rendering', async () => {
    const pdf = readFileSync(join(__dirname, '__fixtures__', 'six-page.pdf'));
    await expect(new ReportOcrService().assertPdfPageLimit(pdf)).rejects.toThrow('REPORT_PDF_PAGE_LIMIT');
  });

  it('bounds concurrent OCR work rather than starting another worker', async () => {
    const ocr = new ReportOcrService();
    const blank = readFileSync(join(__dirname, '__fixtures__', 'blank.png'));
    const first = ocr.read(blank, 'image/png');
    await expect(ocr.read(blank, 'image/png')).rejects.toThrow('REPORT_OCR_BUSY');
    await first;
  });

  it.each(['glucose-photo.png', 'glucose-photo.jpg', 'scanned-glucose.pdf', 'rotated-glucose.png'])(
    'extracts the printed glucose result from %s', async (name) => {
      const result = await upload(name);
      expect(result.extractionStatus).toBe('EXTRACTED');
      expect(result.category).toBe('BLOOD_GLUCOSE');
      expect(result.facts.tests).toEqual([expect.objectContaining({ name: 'Fasting Blood Glucose',
        value: '110', unit: 'mg/dL', referenceRange: '70-99 mg/dL',
        source: expect.objectContaining({ page: 1, confidence: expect.any(Number), bbox: expect.any(Object) }) })]);
      expect(result.facts.verification).toBe('INDEPENDENT_OCR_V1');
    });

  it('extracts the printed HbA1c result', async () => {
    const result = await upload('hba1c-photo.png');
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect(result.category).toBe('HBA1C');
    expect(result.facts.tests).toEqual([expect.objectContaining({ name: 'HbA1c', value: '6.2', unit: '%',
      referenceRange: '4.0-5.6 %' })]);
  });

  it.each(['table-glucose.png', 'small-text-glucose.png'])(
    'recovers both supported rows from %s using independently checked OCR evidence', async (name) => {
      const result = await upload(name);
      expect(result.extractionStatus).toBe('EXTRACTED');
      expect(result.category).toBe('GLUCOSE_HBA1C');
      expect(result.readingCompleteness).toBe('UNCONFIRMED');
      expect(result.explanation).toContain('छूट सकते हैं');
      expect(result.facts.tests).toEqual([
        expect.objectContaining({ name: 'Fasting Blood Glucose', value: '110', unit: 'mg/dL',
          referenceRange: '70-99 mg/dL', source: expect.objectContaining({ confidence: expect.any(Number) }) }),
        expect.objectContaining({ name: 'HbA1c', value: '6.2', unit: '%',
          referenceRange: '4.0-5.6 %', source: expect.objectContaining({ confidence: expect.any(Number) }) }),
      ]);
    });

  it('reads both printed values in a mixed Hindi and English report', async () => {
    const result = await upload('mixed-hindi-english.png');
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect(result.category).toBe('GLUCOSE_HBA1C');
    expect(result.facts.tests).toEqual([
      expect.objectContaining({ name: 'Fasting Blood Glucose', value: '110', unit: 'mg/dL',
        referenceRange: '70-99 mg/dL', evidence: expect.stringContaining('रक्त शर्करा') }),
      expect.objectContaining({ name: 'HbA1c', value: '6.2', unit: '%', referenceRange: '4.0-5.6 %' }),
    ]);
  });

  it.each(['blank.png', 'blurry-glucose.png', 'conflict-photo.png', 'no-values-large.png', 'hindi-glucose.png'])(
    'does not claim unverified values from %s', async (name) => {
      const result = await upload(name);
      expect(result.extractionStatus).toBe('UNREADABLE');
      expect(result.category).toBeNull();
      expect(result.facts.tests).toEqual([]);
    });

  it('keeps text-based PDF extraction working', async () => {
    const result = await upload('text.pdf');
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect(result.facts.tests).toEqual([
      expect.objectContaining({ name: 'Fasting Blood Glucose', value: '110', unit: 'mg/dL', referenceRange: '70-99 mg/dL' }),
      expect.objectContaining({ name: 'HbA1c', value: '6.2', unit: '%', referenceRange: '4.0-5.6 %' }),
    ]);
  });
});
