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
  it.each([
    ['CBC', 'Hemoglobin 12.4 g/dL 12.0-15.5 g/dL\nWBC Count 6800 /uL 4000-11000 /uL\nPlatelets 250000 /uL 150000-450000 /uL',
      [['Hemoglobin', '12.4', '12.0-15.5 g/dL'], ['WBC Count', '6800', '4000-11000 /uL'], ['Platelets', '250000', '150000-450000 /uL']]],
    ['thyroid', 'TSH 2.4 uIU/mL 0.4-4.0 uIU/mL\nT4 8.1 mcg/dL 5-12 mcg/dL',
      [['TSH', '2.4', '0.4-4.0 uIU/mL'], ['T4', '8.1', '5-12 mcg/dL']]],
    ['kidney', 'Creatinine 1.1 mg/dL 0.6-1.3 mg/dL\nUrea 28 mg/dL 15-40 mg/dL',
      [['Creatinine', '1.1', '0.6-1.3 mg/dL'], ['Urea', '28', '15-40 mg/dL']]],
    ['liver', 'ALT 32 U/L 7-56 U/L\nBilirubin 0.8 mg/dL 0.2-1.2 mg/dL',
      [['ALT', '32', '7-56 U/L'], ['Bilirubin', '0.8', '0.2-1.2 mg/dL']]],
    ['lipids', 'Total Cholesterol 180 mg/dL 125-200 mg/dL\nHDL 50 mg/dL 40-60 mg/dL\nLDL 110 mg/dL 0-130 mg/dL\nTriglycerides 140 mg/dL 0-150 mg/dL',
      [['Total Cholesterol', '180', '125-200 mg/dL'], ['HDL', '50', '40-60 mg/dL'],
        ['LDL', '110', '0-130 mg/dL'], ['Triglycerides', '140', '0-150 mg/dL']]],
    ['unknown', 'Mystery Marker 7.3 U/L 5-9 U/L', [['Mystery Marker', '7.3', '5-9 U/L']]],
  ])('reads generic %s rows without assuming a glucose test', (_kind, source, expected) => {
    const { service } = build();
    const facts = (service as any).factsFromTextLayer(source);
    expect(facts.tests.map(({ name, value, referenceRange }: any) => [name, value, referenceRange])).toEqual(expected);
  });

  it('reads a printed urine result and reference category without a numeric comparison', () => {
    const { service } = build();
    const facts = (service as any).factsFromTextLayer('Urine Protein Negative Negative');
    expect(facts.tests).toEqual([expect.objectContaining({ name: 'Urine Protein', value: 'Negative',
      referenceRange: 'Negative', unit: null })]);
  });

  it('retains a lab-printed high flag without using it as the measured value', () => {
    const { service } = build();
    const facts = (service as any).factsFromTextLayer('GLUCOSE, FASTING 245.00 Very High 70.00-100.00 mg/dL');
    expect(facts.tests).toEqual([expect.objectContaining({ name: 'GLUCOSE, FASTING', value: '245.00',
      unit: 'mg/dL', referenceRange: '70.00-100.00 mg/dL', flag: 'Very High' })]);
  });

  it('answers a named CBC test without repeating other results and identifies only verified high rows', async () => {
    const { service, reports } = build();
    const row = { id: 'cbc-a', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a',
      mimeType: 'application/pdf', extractionStatus: 'EXTRACTED',
      extractedFacts: { reportName: 'Complete Blood Count', reportDate: '03/Apr/2023', verification: 'PDF_TEXT_LAYER_V1',
        tests: [
          { name: 'Hemoglobin', value: '12.4', unit: 'g/dL', referenceRange: '12.0-15.5 g/dL', evidence: 'Hemoglobin 12.4 g/dL 12.0-15.5 g/dL' },
          { name: 'WBC Count', value: '13000', unit: '/uL', referenceRange: '4000-11000 /uL', evidence: 'WBC Count 13000 /uL 4000-11000 /uL' },
          { name: 'Platelets', value: '250000', unit: '/uL', referenceRange: null, evidence: 'Platelets 250000 /uL' },
        ] } };
    const builder: any = { where: jest.fn(), getOne: jest.fn().mockResolvedValue(row) };
    builder.where.mockReturnValue(builder);
    reports.createQueryBuilder.mockReturnValue(builder);
    const detail = await service.detail('session-a', 'cbc-a', identity);
    expect(detail.reportType).toBe('CBC');
    const named = await service.answerQuestion('session-a', 'cbc-a', identity, 'Mera hemoglobin kitna hai?');
    expect(named.content.summary).toContain('Hemoglobin:');
    expect(named.content.summary).toContain('12.4 g/dL');
    expect(named.content.summary).not.toContain('WBC Count:');
    const absent = await service.answerQuestion('session-a', 'cbc-a', identity, 'Mera thyroid kitna hai?');
    expect(absent.content.summary).toContain('सत्यापित नतीजों में नहीं मिली');
    expect(absent.content.summary).not.toContain('Hemoglobin:');
    const high = await service.answerQuestion('session-a', 'cbc-a', identity, 'Kaun si values high hain?');
    expect(high.content.summary).toContain('WBC Count:');
    expect(high.content.summary).toContain('13000 /uL');
    expect(high.content.summary).not.toContain('Hemoglobin:');
    expect(high.content.summary).not.toContain('Platelets:');
    const doctor = await service.answerQuestion('session-a', 'cbc-a', identity, 'Doctor ko dikhana chahiye?');
    expect(doctor.content.summary).toContain('डॉक्टर से बात करें');
  });

  it('compares only the same verified test and unit across dated reports for the same patient', async () => {
    const { service, reports } = build();
    const current = { id: 'current', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a',
      mimeType: 'application/pdf', extractionStatus: 'EXTRACTED',
      extractedFacts: { reportName: null, reportDate: '03/Apr/2023', verification: 'PDF_TEXT_LAYER_V1',
        tests: [{ name: 'Fasting Glucose', value: '110', unit: 'mg/dL', referenceRange: '70-99 mg/dL' }] } };
    const old = { ...current, id: 'old', extractedFacts: { ...current.extractedFacts, reportDate: '01/Apr/2023',
      tests: [{ name: 'Fasting Glucose', value: '100', unit: 'mg/dL', referenceRange: '70-99 mg/dL' },
        { name: 'Random Glucose', value: '180', unit: 'mg/dL', referenceRange: '74-140 mg/dL' }] } };
    const otherPatient = { ...old, id: 'foreign', patientRef: 'mobile-user:patient-b',
      extractedFacts: { ...old.extractedFacts, tests: [{ name: 'Fasting Glucose', value: '999', unit: 'mg/dL', referenceRange: null }] } };
    const builder: any = { where: jest.fn(), getOne: jest.fn().mockResolvedValue(current) };
    builder.where.mockReturnValue(builder);
    reports.createQueryBuilder.mockReturnValue(builder);
    reports.find.mockResolvedValue([otherPatient, old, current]);
    const answer = await service.answerQuestion('session-a', 'current', identity, 'Pichli report se kya difference hai?');
    expect(answer.content.summary).toContain('100 mg/dL');
    expect(answer.content.summary).toContain('110 mg/dL');
    expect(answer.content.summary).not.toContain('999');
    expect(answer.content.summary).not.toContain('180');
  });

  it('reconstructs one OCR table row from aligned column boxes with page provenance', () => {
    const { service } = build();
    const boxes = [
      { text: 'Hemoglobin', bbox: { x0: 10, y0: 100, x1: 120, y1: 120 } },
      { text: '12.4', bbox: { x0: 160, y0: 101, x1: 195, y1: 120 } },
      { text: 'g/dL', bbox: { x0: 210, y0: 100, x1: 245, y1: 120 } },
      { text: '12.0-15.5', bbox: { x0: 270, y0: 102, x1: 350, y1: 121 } },
    ].map((line) => ({ ...line, page: 2, confidence: 94 }));
    const facts = (service as any).factsFromTextLayer(boxes.map((line) => line.text).join('\n'), boxes);
    expect(facts.tests).toEqual([expect.objectContaining({ name: 'Hemoglobin', value: '12.4',
      unit: 'g/dL', referenceRange: '12.0-15.5', source: expect.objectContaining({ page: 2, confidence: 94,
        bbox: { x0: 10, y0: 100, x1: 350, y1: 121 } }) })]);
  });

  it('does not merge values from separate OCR table rows', () => {
    const { service } = build();
    const lines = [
      { text: 'Hemoglobin', page: 1, confidence: 95, bbox: { x0: 10, y0: 100, x1: 120, y1: 120 } },
      { text: '12.4 g/dL', page: 1, confidence: 95, bbox: { x0: 150, y0: 100, x1: 230, y1: 120 } },
      { text: 'WBC Count', page: 1, confidence: 95, bbox: { x0: 10, y0: 145, x1: 120, y1: 165 } },
      { text: '6800 /uL', page: 1, confidence: 95, bbox: { x0: 150, y0: 145, x1: 230, y1: 165 } },
    ];
    const facts = (service as any).factsFromTextLayer(lines.map((line) => line.text).join('\n'), lines);
    expect(facts.tests.map(({ name, value }: any) => [name, value])).toEqual([
      ['Hemoglobin', '12.4'], ['WBC Count', '6800'],
    ]);
  });

  it('does not reconstruct a measured value from aligned interpretation text', () => {
    const { service } = build();
    const lines = [
      { text: 'Interpretation', page: 1, confidence: 96, bbox: { x0: 10, y0: 200, x1: 150, y1: 220 } },
      { text: 'Glucose', page: 1, confidence: 95, bbox: { x0: 10, y0: 240, x1: 110, y1: 260 } },
      { text: '200 mg/dL', page: 1, confidence: 95, bbox: { x0: 150, y0: 240, x1: 290, y1: 260 } },
    ];
    const facts = (service as any).factsFromTextLayer(lines.map((line) => line.text).join('\n'), lines);
    expect(facts.tests).toEqual([]);
  });

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

  it('reads a split RBS PDF table but never treats interpretation thresholds as measured results', async () => {
    const { service, ocr, ai, reports } = build();
    ocr.readPdfTextLayer.mockResolvedValue([
      'Random Blood Sugar, RBS (Glucose), Fluoride Plasma',
      'Date \t03/Apr/2023', 'Unit \tBio Ref Interval', 'Random Glucose', 'Hexokinase',
      '84 \tmg/dL \t74 - 140',
      'Interpretation A random plasma glucose of > 200 mg/dL may need follow-up.',
    ].join('\n'));
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    const file = { buffer: Buffer.from('%PDF- synthetic RBS table'), originalname: 'synthetic.pdf', mimetype: 'application/pdf' };
    const result = await service.upload('session-a', identity, file, true, 'hi', 'corr');
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect(result.facts.reportDate).toBe('03/Apr/2023');
    expect(result.facts.tests).toEqual([expect.objectContaining({ name: 'Random Glucose', value: '84',
      unit: 'mg/dL', referenceRange: '74 - 140' })]);
    expect(result.explanation).toContain('84 mg/dL');
    expect(result.explanation).toContain('74–140 mg/dL');
    expect(result.explanation).toContain('इस सीमा के भीतर है');
    expect(result.explanation).toContain('एक रिपोर्ट से बीमारी की पुष्टि या खारिज नहीं होती');
    expect(result.explanation).not.toContain('200');
    expect(ai.generate).not.toHaveBeenCalled();
    const builder: any = { where: jest.fn(), getOne: jest.fn().mockResolvedValue({
      id: 'synthetic-rbs', tenantId: 'tenant-a', patientRef: 'mobile-user:patient-a',
      mimeType: 'application/pdf', extractionStatus: 'EXTRACTED', extractedFacts: result.facts,
    }) };
    builder.where.mockReturnValue(builder);
    reports.createQueryBuilder.mockReturnValue(builder);
    const detail = await service.detail('session-a', 'synthetic-rbs', { ...identity, preferredLanguage: 'hi' });
    expect(detail.explanation).toContain('84 mg/dL');
    expect(detail.explanation).toContain('इस सीमा के भीतर है');
    const answer = await service.answerQuestion('session-a', 'synthetic-rbs', { ...identity, preferredLanguage: 'hi' },
      'क्या यह नतीजा सामान्य सीमा में है?');
    expect(answer.content.summary).toContain('84 mg/dL');
    expect(answer.content.summary).toContain('इस सीमा के भीतर है');
    expect(answer.content.sections).toEqual([]);
  });

  it('rejects an AI candidate taken from an interpretation threshold', () => {
    const { service } = build();
    const evidence = 'Interpretation A random plasma glucose of > 200 mg/dL may need follow-up.';
    const facts = (service as any).factsFromOcr({ tests: [{ name: 'glucose', value: '200',
      unit: 'mg/dL', evidence }] }, evidence);
    expect(facts.tests).toEqual([]);
  });

  it.each([
    ['GLUCOSE, FASTING', '245.00', 'mg/dL', '70.00-100.00', 'इससे ज्यादा है'],
    ['HbA1c', '6.2', '%', '4.0-5.6', 'इससे ज्यादा है'],
    ['Random Glucose', '84', 'mg/dL', '74-140', 'इस सीमा के भीतर है'],
  ])('explains verified %s against its printed lab range', async (name, value, unit, referenceRange, comparison) => {
    const { service, ocr } = build();
    ocr.readPdfTextLayer.mockResolvedValue(`${name} ${value} ${unit} ${referenceRange}`);
    const file = { buffer: Buffer.from('%PDF- synthetic measurement'), originalname: 'synthetic.pdf', mimetype: 'application/pdf' };
    const result = await service.upload('session-a', identity, file, true, 'hi', 'corr');
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect((result.facts.tests as any[])[0]).toEqual(expect.objectContaining({ name, value, unit, referenceRange }));
    expect(result.explanation).toContain(unit === '%' ? `${value}%` : `${value} ${unit}`);
    expect(result.explanation).toContain(comparison);
    expect(result.explanation).toContain('इस लैब की छपी सीमा');
    if (comparison === 'इससे ज्यादा है') expect(result.explanation).toContain('डॉक्टर से बात करें');
    expect(result.explanation).toContain('दवा या खुराक डॉक्टर की सलाह के बिना न बदलें');
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

  it('shows a verified table value while withholding its uncertain reference range', async () => {
    const { service, ocr, ai } = build();
    ocr.read.mockResolvedValue({ lines: [{ text: 'GLUCOSE, FASTING, 245.00', page: 1, confidence: 95,
      bbox: { x0: 1, y0: 2, x1: 100, y1: 20 },
      measurement: { name: 'GLUCOSE, FASTING', value: '245.00', unit: 'mg/dL', referenceRange: null } }],
    hasUncertainRows: true });
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'table.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect(result.facts.tests).toEqual([expect.objectContaining({ name: 'GLUCOSE, FASTING', value: '245.00',
      unit: 'mg/dL', referenceRange: null, evidence: 'GLUCOSE, FASTING, 245.00' })]);
    expect(result.readingCompleteness).toBe('POSSIBLY_PARTIAL');
    expect(result.category).toBeNull();
    expect(result.explanation).toContain('245.00 mg/dL');
    expect(result.explanation).toContain('lab range was not read reliably');
    expect(result.explanation).toContain('cannot be called normal, high, or low');
    expect(result.explanation).not.toContain('70–100');
    expect(ai.generate).not.toHaveBeenCalled();
    const hindi = (service as any).explain(result.facts, 'hi');
    expect(hindi).toContain('इसे सामान्य, ज्यादा या कम नहीं कह सकते');
    expect(hindi).not.toContain('इससे ज्यादा है');
  });

  it('uses an independently read hemoglobin row and rejects a conflicting model value', async () => {
    const { service, ocr, ai } = build();
    ocr.read.mockResolvedValue({ lines: [{ text: 'Hemoglobin 13.2 g/dL', page: 1, confidence: 96,
      bbox: { x0: 1, y0: 2, x1: 100, y1: 20 } }], hasUncertainRows: false });
    ai.healthCheck.mockResolvedValue({ status: 'AVAILABLE' });
    ai.generate.mockResolvedValue({ json: { tests: [{ name: 'Hemoglobin', value: '13.9', unit: 'g/dL',
      evidence: 'Hemoglobin 13.2 g/dL' }] } });
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), originalname: 'report.jpg', mimetype: 'image/jpeg' };
    const result = await service.upload('session-a', identity, file, true, 'en', 'corr');
    expect(ai.generate).not.toHaveBeenCalled();
    expect(result.extractionStatus).toBe('EXTRACTED');
    expect(result.facts.tests).toEqual([expect.objectContaining({ name: 'Hemoglobin', value: '13.2', unit: 'g/dL' })]);
    expect((service as any).factsFromOcr({ tests: [{ name: 'Hemoglobin', value: '13.9', unit: 'g/dL',
      evidence: 'Hemoglobin 13.2 g/dL' }] }, 'Hemoglobin 13.2 g/dL').tests).toEqual([]);
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
    expect(hinglish.content.summary).toContain('रिपोर्ट में 110 लिखा है');
    expect(hinglish.content.sections).toEqual([]);
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
