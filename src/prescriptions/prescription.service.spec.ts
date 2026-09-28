import { Prescription } from '../database/entities/prescription.entity';
import { PrescriptionService } from './prescription.service';

const record = (overrides: Partial<Prescription>): Prescription => ({
  id: 'record',
  tenantId: 'tenant-a',
  patientRef: 'mobile-user:patient-a',
  sessionId: '11111111-1111-1111-1111-111111111111',
  prescriptionId: 'domain-record',
  prescriptionDate: null,
  prescriberName: null,
  sourceDocumentId: 'source-record',
  filename: 'prescription.pdf',
  sourceMimeType: 'application/pdf',
  sourceFile: null,
  checksum: 'checksum',
  extractedText: '',
  medications: [],
  investigations: [],
  verifiedMedications: null,
  verifiedInvestigations: null,
  extractionStatus: 'EXTRACTED',
  verificationStatus: 'PENDING_VERIFICATION',
  verifiedBy: null,
  verifierRole: null,
  verifiedAt: null,
  verificationNote: null,
  patientReviewReason: null,
  planRevision: 1,
  supersedesPrescriptionId: null,
  activePlan: false,
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  updatedAt: new Date('2026-09-20T00:00:00.000Z'),
  ...overrides,
});

describe('PrescriptionService patient decision guidance', () => {
  const build = (records: Prescription[]) => {
    const repository = {
      findOne: jest.fn(async ({ where }: any) => {
        const matches = records.filter((item) => Object.entries(where).every(([key, value]) => (item as any)[key] === value));
        return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] || null;
      }),
    };
    const transactionRepository = {
      createQueryBuilder: jest.fn(),
      save: jest.fn(async (value: Prescription) => value),
    };
    transactionRepository.createQueryBuilder.mockImplementation(() => {
      let parameters: Record<string, unknown> = {};
      const builder: any = {};
      builder.setLock = jest.fn(() => builder);
      builder.where = jest.fn((_query: string, values: Record<string, unknown>) => { parameters = values; return builder; });
      builder.getOne = jest.fn(async () => parameters.id
        ? records.find((item) => item.id === parameters.id && item.tenantId === parameters.tenantId) || null
        : records.find((item) => item.tenantId === parameters.tenantId && item.patientRef === parameters.patientRef && item.activePlan) || null);
      return builder;
    });
    const dataSource = { transaction: jest.fn(async (work: (manager: any) => unknown) => work({ getRepository: () => transactionRepository })) };
    const audit = { logEvent: jest.fn(async () => undefined) };
    const service = new PrescriptionService(repository as any, dataSource as any, audit as any, {} as any, {} as any);
    return { service, audit };
  };

  it('returns only the latest current-patient safe reason and never the internal note', async () => {
    const records = [
      record({ id: 'patient-a-old', patientReviewReason: 'Old reason', verificationStatus: 'REJECTED', createdAt: new Date('2026-09-18T00:00:00Z') }),
      record({ id: 'patient-a-latest', patientReviewReason: 'Please upload the complete signed prescription.', verificationNote: 'Internal fraud-screening note', verificationStatus: 'NEEDS_RESUBMISSION', createdAt: new Date('2026-09-22T00:00:00Z') }),
      record({ id: 'patient-b-latest', patientRef: 'mobile-user:patient-b', patientReviewReason: 'Reason belonging to patient B', verificationStatus: 'REJECTED', createdAt: new Date('2026-09-23T00:00:00Z') }),
    ];
    const { service } = build(records);

    const state = await service.currentSessionState('tenant-a', 'mobile-user:patient-a', 'session-a');

    expect(state.latestSubmission).toMatchObject({
      id: 'patient-a-latest',
      verificationStatus: 'NEEDS_RESUBMISSION',
      patientReviewReason: 'Please upload the complete signed prescription.',
    });
    expect(state.latestSubmission).not.toHaveProperty('verificationNote');
    expect(JSON.stringify(state)).not.toContain('patient B');
    expect(JSON.stringify(state)).not.toContain('fraud-screening');
  });

  it('keeps the existing verified plan active when a replacement needs resubmission', async () => {
    const active = record({
      id: 'active-a', verificationStatus: 'VERIFIED', activePlan: true, planRevision: 2,
      verifiedMedications: [{ medicationName: 'Existing verified medicine' }],
      createdAt: new Date('2026-09-20T00:00:00Z'),
    });
    const replacement = record({ id: 'replacement-b', planRevision: 3, createdAt: new Date('2026-09-23T00:00:00Z') });
    const { service } = build([active, replacement]);

    await service.reject(
      'tenant-a',
      replacement.id,
      { reason: 'The full prescription is not visible.', note: 'Worker-only note' },
      { tenantId: 'tenant-a', externalId: 'worker-1', workerRole: 'ASHA' } as any,
      'correlation-id',
      true,
    );
    const state = await service.currentSessionState('tenant-a', replacement.patientRef, 'session-a');

    expect(active).toMatchObject({ verificationStatus: 'VERIFIED', activePlan: true, planRevision: 2 });
    expect(replacement).toMatchObject({
      verificationStatus: 'NEEDS_RESUBMISSION',
      activePlan: false,
      patientReviewReason: 'The full prescription is not visible.',
      verificationNote: 'Worker-only note',
    });
    expect(state.activePlan?.id).toBe(active.id);
    expect(state.latestSubmission?.id).toBe(replacement.id);
  });

  it('stores a rejected prescription reason separately from the internal worker note', async () => {
    const rejected = record({ id: 'rejected-b', createdAt: new Date('2026-09-23T00:00:00Z') });
    const { service } = build([rejected]);

    await service.reject(
      'tenant-a',
      rejected.id,
      { reason: 'This image is not a valid prescription.', note: 'Internal review detail' },
      { tenantId: 'tenant-a', externalId: 'worker-1', workerRole: 'CHO' } as any,
      'correlation-id',
      false,
    );
    const state = await service.currentSessionState('tenant-a', rejected.patientRef, 'session-a');

    expect(rejected).toMatchObject({ verificationStatus: 'REJECTED', activePlan: false });
    expect(state.latestSubmission?.patientReviewReason).toBe('This image is not a valid prescription.');
    expect(JSON.stringify(state)).not.toContain('Internal review detail');
  });

  it('shows only selected original fields for the current patient pending extraction', async () => {
    const own = record({
      id: 'patient-a-pending',
      verificationNote: 'Internal worker-only note',
      extractedText: 'Private raw OCR text',
      sourceFile: Buffer.from('private image bytes'),
      medications: [{ medicationName: 'Telma 40', strength: '40 mg', frequency: 'once daily', timing: null, confidence: 'HIGH', instructions: 'worker-unreviewed free text' }],
      investigations: [{ rawName: 'HbA1c', confidence: 'LOW', reason: 'private extraction note' }],
    });
    const other = record({ id: 'patient-b-pending', patientRef: 'mobile-user:patient-b', createdAt: new Date('2026-09-23T00:00:00Z'), medications: [{ medicationName: 'Another patient medicine' }] });
    const { service } = build([own, other]);

    const state = await service.currentSessionState('tenant-a', own.patientRef, 'session-a');

    expect(state.latestSubmission?.extractedDetails).toEqual({
      medications: [{ name: 'Telma 40', strength: '40 mg', frequency: 'once daily', timing: null, uncertain: false }],
      investigations: [{ name: 'HbA1c', uncertain: true }],
    });
    expect(JSON.stringify(state)).not.toMatch(/Internal worker-only|Private raw OCR|private image bytes|worker-unreviewed|private extraction note|Another patient medicine/);
    expect(state.activePlan).toBeNull();
  });

  it('preserves review-required uncertain details without inventing missing fields', async () => {
    const { service } = build([record({
      extractionStatus: 'REVIEW_REQUIRED', verificationStatus: 'UNVERIFIED',
      medications: [{ medicationName: 'Partially legible medicine', confidence: 'LOW' }],
      investigations: [{ rawName: 'ECG', confidence: 'LOW' }],
    })]);
    const state = await service.currentSessionState('tenant-a', 'mobile-user:patient-a', 'session-a');
    expect(state.latestSubmission?.extractedDetails).toEqual({
      medications: [{ name: 'Partially legible medicine', strength: null, frequency: null, timing: null, uncertain: true }],
      investigations: [{ name: 'ECG', uncertain: true }],
    });
  });

  it.each(['REJECTED', 'NEEDS_RESUBMISSION', 'SUPERSEDED'] as const)('does not expose %s extraction as current', async (verificationStatus) => {
    const { service } = build([record({ verificationStatus, medications: [{ medicationName: 'Unverified medicine' }], patientReviewReason: 'Please resubmit.' })]);
    const state = await service.currentSessionState('tenant-a', 'mobile-user:patient-a', 'session-a');
    expect(state.latestSubmission).not.toHaveProperty('extractedDetails');
    expect(state.latestSubmission?.patientReviewReason).toBe(verificationStatus === 'SUPERSEDED' ? null : 'Please resubmit.');
  });

  it('keeps A verified and actionable while B extraction is pending', async () => {
    const active = record({ id: 'active-a', verificationStatus: 'VERIFIED', activePlan: true, verifiedMedications: [{ medicationName: 'Verified A' }], verifiedInvestigations: [{ rawName: 'ECG' }] });
    const replacement = record({ id: 'pending-b', createdAt: new Date('2026-09-23T00:00:00Z'), medications: [{ medicationName: 'Extracted B' }], investigations: [{ rawName: 'HbA1c' }] });
    const { service } = build([active, replacement]);
    const state = await service.currentSessionState('tenant-a', active.patientRef, 'session-a');
    expect(state.activePlan?.medications).toEqual([{ medicationName: 'Verified A' }]);
    expect(state.activePlan?.investigations).toEqual([{ rawName: 'ECG' }]);
    expect(state.latestSubmission?.id).toBe('pending-b');
    expect(state.latestSubmission?.extractedDetails?.medications[0].name).toBe('Extracted B');
    expect(state.latestSubmission?.extractedDetails?.investigations[0].name).toBe('HbA1c');
    expect(JSON.stringify(state.activePlan)).not.toContain('Extracted B');
  });
});
