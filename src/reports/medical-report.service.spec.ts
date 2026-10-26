import { MedicalReportService } from './medical-report.service';

const identity = { authType: 'MOBILE', mobileUserId: 'patient-a', tenantId: 'tenant-a', externalId: 'user-a' } as any;
const session = { id: 'session-a', tenantId: 'tenant-a', externalId: 'user-a', subjectAbhaRef: 'mobile-user:patient-a',
  consentArtifactId: 'consent-a', status: 'ACTIVE', idleExpiresAt: new Date(Date.now() + 60_000), absoluteExpiresAt: new Date(Date.now() + 60_000) };

function build() {
  const reports = { create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: 'report-a', createdAt: new Date(), ...value })),
    find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn(), manager: {} as any };
  reports.manager.transaction = jest.fn(async (callback: any) => callback({
    query: jest.fn(), findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((_entity: any, value: any) => value),
    save: jest.fn(async (_entity: any, value: any) => reports.save(value)),
  }));
  const sessions = { findOne: jest.fn().mockResolvedValue(session) };
  const consent = { validateConsent: jest.fn().mockResolvedValue({ id: 'consent-a' }) };
  const ocr = { read: jest.fn().mockResolvedValue({ lines: [], hasUncertainRows: false }),
    assertPdfPageLimit: jest.fn().mockResolvedValue(undefined),
    readPdfTextLayer: jest.fn().mockRejectedValue(new Error('No text layer')) };
  const audit = { logEvent: jest.fn().mockResolvedValue(undefined) };
  const ai = { healthCheck: jest.fn().mockResolvedValue({ status: 'UNAVAILABLE' }), generate: jest.fn() };
  return { service: new MedicalReportService(reports as any, sessions as any, consent as any, ocr as any, audit as any, ai as any),
    reports, sessions, consent, ocr, audit, ai };
}

describe('patient medical reports', () => {
  it('rejects an overlong PDF before extracting or storing it', async () => {
    const { service, ocr, reports } = build();
    ocr.assertPdfPageLimit.mockRejectedValue(new Error('REPORT_PDF_PAGE_LIMIT'));
    const file = { buffer: Buffer.from('%PDF- synthetic'), originalname: 'six.pdf', mimetype: 'application/pdf' };
    await expect(service.upload('session-a', identity, file, true, 'en', 'corr')).rejects.toThrow('REPORT_PDF_PAGE_LIMIT');
    expect(reports.save).not.toHaveBeenCalled();
  });

  it('returns a transient error for a busy OCR worker without storing a failed report', async () => {
    const { service, ocr, reports } = build();
    ocr.read.mockRejectedValue(new Error('REPORT_OCR_BUSY'));
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'a.jpg', mimetype: 'image/jpeg' };
    await expect(service.upload('session-a', identity, file, true, 'en', 'corr')).rejects.toThrow('REPORT_OCR_BUSY');
    expect(reports.save).not.toHaveBeenCalled();
  });

  it('reads an English test line following a Hindi label without changing the printed value', () => {
    const { service } = build();
    const facts = (service as any).factsFromTextLayer('रक्त शर्करा / Fasting Blood Glucose 110 mg/dL 70-99 mg/dL');
    expect(facts.tests).toEqual([expect.objectContaining({ name: 'Fasting Blood Glucose', value: '110',
      unit: 'mg/dL', referenceRange: '70-99 mg/dL' })]);
  });

  it('requires explicit upload consent and rejects a mismatched file signature', async () => {
    const { service, reports } = build();
    const fakePdf = { buffer: Buffer.from('not a PDF'), originalname: 'report.pdf', mimetype: 'application/pdf' };
    await expect(service.upload('session-a', identity, fakePdf, false, 'hi', 'corr')).rejects.toThrow('REPORT_UPLOAD_CONSENT_REQUIRED');
    await expect(service.upload('session-a', identity, fakePdf, true, 'hi', 'corr')).rejects.toThrow('UNSUPPORTED_REPORT_FILE');
    expect(reports.save).not.toHaveBeenCalled();
  });

  it('stores an unreadable source without inventing results when OCR fails', async () => {
    const { service, reports, audit } = build();
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'a.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(result.extractionStatus).toBe('UNREADABLE');
    expect(result.facts).toEqual({ reportName: null, reportDate: null, tests: [] });
    expect(result).not.toHaveProperty('sourceFile');
    expect(reports.save).toHaveBeenCalledWith(expect.objectContaining({ patientRef: 'mobile-user:patient-a', sourceFile: file.buffer }));
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ mimeType: 'image/jpeg', extractionStatus: 'UNREADABLE' }) }));
  });

  it('does not expose AI-only image facts without independent OCR evidence', async () => {
    const { service, ai } = build();
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'synthetic-camera.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'hi', 'corr');
    expect(result.facts.tests).toEqual([]);
    expect(result.category).toBeNull();
    expect(result.extractionStatus).toBe('UNREADABLE');
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('does not count PDF page markers as report text for a scanned PDF', async () => {
    const { service, ocr, ai } = build();
    ocr.readPdfTextLayer.mockResolvedValue('-- 1 of 1 --');
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    const file = { buffer: Buffer.from('%PDF- synthetic scan'), originalname: 'scan.pdf', mimetype: 'application/pdf' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(result.extractionStatus).toBe('UNREADABLE');
    expect(result.facts.tests).toEqual([]);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('distinguishes a local OCR failure from an unreadable image', async () => {
    const { service, ocr } = build();
    ocr.read.mockRejectedValue(new Error('synthetic OCR worker failure'));
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'report.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(result.extractionStatus).toBe('EXTRACTION_FAILED');
    expect(result.facts.tests).toEqual([]);
    expect(result.explanation).toContain('processing failed');
  });

  it('uses deterministic OCR evidence without making a Gemini call', async () => {
    const { service, ocr, ai } = build();
    ocr.read.mockResolvedValue({ lines: [{ text: 'Glucose 110 mg/dL', page: 1, confidence: 96,
      bbox: { x0: 1, y0: 2, x1: 100, y1: 20 } }], hasUncertainRows: false });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { tests: [{ name: 'Glucose', value: '180', unit: 'mg/dL',
      evidence: 'Glucose 110 mg/dL' }] } });
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'report.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect(result.facts.tests).toEqual([expect.objectContaining({ name: 'Glucose', value: '110', unit: 'mg/dL',
      source: expect.objectContaining({ page: 1, confidence: 96 }) })]);
    expect(result.facts.verification).toBe('INDEPENDENT_OCR_V1');
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('flags a partial reading and does not classify it for replacement', async () => {
    const { service, ocr } = build();
    ocr.read.mockResolvedValue({ lines: [{ text: 'Glucose 110 mg/dL', page: 1, confidence: 96,
      bbox: { x0: 1, y0: 2, x1: 100, y1: 20 } }], hasUncertainRows: true });
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'partial.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(result.facts.tests).toEqual([expect.objectContaining({ name: 'Glucose', value: '110' })]);
    expect(result.category).toBeNull();
    expect(result.readingCompleteness).toBe('POSSIBLY_PARTIAL');
    expect(result.explanation).toContain('Some results may have been missed');
  });

  it('rejects a model value that differs from an OCR line', async () => {
    const { service, ocr, ai } = build();
    ocr.read.mockResolvedValue({ lines: [{ text: 'Hemoglobin 13.2 g/dL', page: 1, confidence: 96,
      bbox: { x0: 1, y0: 2, x1: 100, y1: 20 } }], hasUncertainRows: false });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { tests: [{ name: 'Hemoglobin', value: '13.9', unit: 'g/dL',
      evidence: 'Hemoglobin 13.2 g/dL' }] } });
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'report.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(result.extractionStatus).toBe('UNREADABLE');
    expect(result.facts.tests).toEqual([]);
  });

  it('masks previously stored unverified image values in API and chat responses', async () => {
    const { service, reports } = build();
    const old = { id: 'old-image', mimeType: 'image/png', extractionStatus: 'EXTRACTED', category: 'BLOOD_GLUCOSE',
      extractedFacts: { reportName: 'Sugar', reportDate: null, tests: [{ name: 'Glucose', value: '120', unit: 'mg/dL', referenceRange: null }] } };
    const builder: any = { where: jest.fn(), getOne: jest.fn().mockResolvedValue(old) };
    builder.where.mockReturnValue(builder);
    reports.createQueryBuilder.mockReturnValue(builder);
    const detail = await service.detail('session-a', 'old-image', identity);
    expect(detail.facts.tests).toEqual([]);
    expect(detail.category).toBeNull();
    const answer = await service.answerQuestion('session-a', 'old-image', identity, 'Explain this report');
    expect(answer.content.sections).toEqual([]);
  });

  it('masks older PDF facts without provenance while retaining original-file access and history', async () => {
    const { service, reports } = build();
    const old = { id: 'old-pdf', mimeType: 'application/pdf', extractionStatus: 'EXTRACTED', category: 'HBA1C',
      extractedFacts: { reportName: 'Old report', reportDate: null,
        tests: [{ name: 'HbA1c', value: '6.2', unit: '%', referenceRange: null }] }, isCurrent: true,
      sourceFile: Buffer.from('%PDF- original synthetic report') };
    const builder: any = { where: jest.fn(), addSelect: jest.fn(), getOne: jest.fn().mockResolvedValue(old) };
    builder.where.mockReturnValue(builder);
    builder.addSelect.mockReturnValue(builder);
    reports.createQueryBuilder.mockReturnValue(builder);
    reports.find.mockResolvedValue([old]);
    const detail = await service.detail('session-a', 'old-pdf', identity);
    expect(detail.facts.tests).toEqual([]);
    expect(detail.readingCompleteness).toBe('NOT_VERIFIED');
    expect(detail.explanation).toContain('स्रोत सत्यापित नहीं');
    expect(await service.list('session-a', identity)).toHaveLength(1);
    expect((await service.source('session-a', 'old-pdf', identity, 'corr')).buffer).toEqual(old.sourceFile);
    const answer = await service.answerQuestion('session-a', 'old-pdf', identity, 'Explain this report');
    expect(answer.content.sections).toEqual([]);
  });

  it('keeps missing units and unsupported values absent', () => {
    const { service } = build();
    const text = 'Glucose 110\nHbA1c 6.2 %';
    const facts = (service as any).factsFromOcr({ tests: [
      { name: 'Glucose', value: '110', unit: 'mg/dL', evidence: 'Glucose 110' },
      { name: 'HbA1c', value: '7.2', unit: '%', evidence: 'HbA1c 6.2 %' },
    ] }, text);
    expect(facts.tests).toEqual([{ name: 'Glucose', value: '110', unit: null, referenceRange: null, evidence: 'Glucose 110' }]);
  });

  it('does not treat a substring or reference-range number as the measured value', () => {
    const { service } = build();
    const facts = (service as any).factsFromOcr({ tests: [
      { name: 'Glucose', value: '110', evidence: 'Glucose 1100 mg/dL' },
      { name: 'Glucose', value: '70', evidence: 'Glucose 110 mg/dL 70-99 mg/dL' },
      { name: 'Glucose', value: '110', unit: 'mg/dL', evidence: 'Glucose 110 180 mg/dL' },
    ] }, 'Glucose 1100 mg/dL\nGlucose 110 mg/dL 70-99 mg/dL\nGlucose 110 180 mg/dL');
    expect(facts.tests).toEqual([]);
  });

  it('distinguishes blood glucose, HbA1c, combined, and unclassified evidence', () => {
    const { service } = build();
    const facts = (names: string[]) => ({ reportName: 'Sugar', reportDate: null,
      tests: names.map((name) => ({ name, value: '1', unit: null, referenceRange: null, evidence: `${name} 1` })) });
    expect((service as any).categoryFromFacts(facts(['Fasting Blood Glucose']))).toBe('BLOOD_GLUCOSE');
    expect((service as any).categoryFromFacts(facts(['HbA1c']))).toBe('HBA1C');
    expect((service as any).categoryFromFacts(facts(['Glucose', 'HbA1c']))).toBe('GLUCOSE_HBA1C');
    expect((service as any).categoryFromFacts(facts(['Hemoglobin']))).toBeNull();
  });

  it('reads only literal supported values and ranges from a PDF text layer', () => {
    const { service } = build();
    const facts = (service as any).factsFromTextLayer('Fasting Blood Glucose 110 mg/dL 70-99 mg/dL\nHbA1c 6.2 % 4.0-5.6 %\nDiagnosis: diabetes');
    expect(facts.tests).toEqual([
      expect.objectContaining({ name: 'Fasting Blood Glucose', value: '110', unit: 'mg/dL', referenceRange: '70-99 mg/dL' }),
      expect.objectContaining({ name: 'HbA1c', value: '6.2', unit: '%', referenceRange: '4.0-5.6 %' }),
    ]);
  });

  it('replaces only the owned current report in a transaction', async () => {
    const { service, reports } = build();
    const current = { id: 'old', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a', category: 'BLOOD_GLUCOSE', isCurrent: true };
    const pending = { id: 'new', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a', category: 'BLOOD_GLUCOSE',
      isCurrent: false, replacementOf: 'old', extractionStatus: 'EXTRACTED', mimeType: 'application/pdf',
      extractedFacts: { verification: 'PDF_TEXT_LAYER_V1', tests: [] } };
    const manager = { query: jest.fn(), findOne: jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(current),
      save: jest.fn(async (_entity: any, value: any) => value) };
    reports.manager.transaction = jest.fn(async (callback: any) => callback(manager));
    const result = await service.confirmReplacement('session-a', 'new', identity, 'corr');
    expect(current.isCurrent).toBe(false);
    expect(pending.isCurrent).toBe(true);
    expect(pending.replacementOf).toBeNull();
    expect(result.isCurrent).toBe(true);
    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a', category: 'BLOOD_GLUCOSE' }),
    }));
  });

  it('permits replacement by a verified OCR image but not an old unverified image', async () => {
    const { service, reports } = build();
    const current = { id: 'old', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a',
      category: 'BLOOD_GLUCOSE', isCurrent: true };
    const pending = { id: 'new', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a',
      category: 'BLOOD_GLUCOSE', isCurrent: false, replacementOf: 'old', extractionStatus: 'EXTRACTED',
      mimeType: 'image/jpeg', extractedFacts: { verification: 'INDEPENDENT_OCR_V1', tests: [] } };
    const manager = { query: jest.fn(), findOne: jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(current),
      save: jest.fn(async (_entity: any, value: any) => value) };
    reports.manager.transaction = jest.fn(async (callback: any) => callback(manager));
    await expect(service.confirmReplacement('session-a', 'new', identity, 'corr')).resolves.toEqual(
      expect.objectContaining({ isCurrent: true }));
    pending.isCurrent = false;
    pending.replacementOf = 'old';
    delete (pending.extractedFacts as any).verification;
    manager.findOne.mockReset().mockResolvedValueOnce(pending);
    await expect(service.confirmReplacement('session-a', 'new', identity, 'corr'))
      .rejects.toThrow('REPORT_REPLACEMENT_NOT_PENDING');
  });

  it('does not return a different patient report or offer a clinical conclusion', async () => {
    const { service, reports } = build();
    const builder: any = { where: jest.fn(), getOne: jest.fn().mockResolvedValue(null) };
    builder.where.mockReturnValue(builder);
    reports.createQueryBuilder.mockReturnValue(builder);
    await expect(service.detail('session-a', 'other-report', identity)).rejects.toThrow('REPORT_NOT_FOUND');
    expect(builder.where).toHaveBeenCalledWith(expect.stringContaining('r.patientRef = :patientRef'),
      expect.objectContaining({ tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a' }));
    builder.getOne.mockResolvedValue({ id: 'report-a', mimeType: 'application/pdf', extractionStatus: 'EXTRACTED',
      extractedFacts: { verification: 'PDF_TEXT_LAYER_V1',
        tests: [{ name: 'Glucose', value: '110', unit: null, referenceRange: null }] } });
    const answer = await service.answerQuestion('session-a', 'report-a', identity, 'Should I change my medicine dose?');
    expect(answer.content.sections).toEqual([]);
    expect(answer.content.summary).toContain('cannot diagnose or decide treatment');
    const hinglish = await service.answerQuestion('session-a', 'report-a', { ...identity, preferredLanguage: 'hi' }, 'Mujhe samjha do');
    expect(hinglish.content.summary).toContain('इस रिपोर्ट');
  });

  it('keeps a patient’s reports available after a new valid session and consent', async () => {
    const { service, reports, sessions, consent } = build();
    sessions.findOne.mockResolvedValue({ ...session, id: 'session-b', consentArtifactId: 'consent-b' });
    await service.list('session-b', identity);
    expect(consent.validateConsent).toHaveBeenCalledWith('consent-b', 'tenant-a', 'user-a', ['record_read']);
    expect(reports.find).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a' },
    }));
  });
});
