import { Repository } from 'typeorm';
import { ClinicalFollowUpAttendance } from '../database/entities/clinical-follow-up-attendance.entity';
import { Session } from '../database/entities/session.entity';
import { PatientDataProvider, PatientDataRecord } from '../dev/patient-data/patient-data-provider.interface';
import { FollowUpService } from './follow-up.service';

const tenantId = '00000000-0000-0000-0000-000000000001';
const sessionId = '00000000-0000-0000-0000-000000000002';
const patientRef = 'synthetic:follow-up-test';
const today = '2026-09-08';

const dateFromToday = (offset: number): string => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const record = (overrides: Partial<PatientDataRecord> = {}): PatientDataRecord => ({
  id: 'follow-up-test', name: 'Synthetic Follow-up Patient', source: 'synthetic', timezone: 'Asia/Kolkata',
  clinicalProfile: { diagnoses: [], medications: [], labResults: [], allergies: [], prescriptions: [], carePlans: [], encounters: [], scheduledEvents: [] },
  ...overrides,
});

describe('FollowUpService', () => {
  let profile = record();
  const session = { id: sessionId, tenantId, subjectAbhaRef: patientRef } as Session;
  const patientData: jest.Mocked<PatientDataProvider> = {
    getPatients: jest.fn(), getPatient: jest.fn(), getClinicalContext: jest.fn(), getPatientByReference: jest.fn(),
  };
  const sessions = { findOne: jest.fn() } as unknown as jest.Mocked<Repository<Session>>;
  const attendance = {
    find: jest.fn(), findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn(),
  } as unknown as jest.Mocked<Repository<ClinicalFollowUpAttendance>>;
  let service: FollowUpService;

  beforeEach(() => {
    jest.clearAllMocks();
    profile = record();
    patientData.getPatientByReference.mockResolvedValue(profile);
    sessions.findOne.mockResolvedValue(session);
    attendance.find.mockResolvedValue([]);
    attendance.findOne.mockResolvedValue(null);
    attendance.save.mockResolvedValue({} as ClinicalFollowUpAttendance);
    service = new FollowUpService(patientData, sessions, attendance);
    jest.spyOn(service as unknown as { now: () => Date }, 'now').mockReturnValue(new Date(`${today}T10:00:00+05:30`));
  });

  it.each([
    ['today', 0, 'DUE_TODAY'],
    ['tomorrow', 1, 'DUE_TOMORROW'],
    ['within seven days', 7, 'UPCOMING'],
  ])('lists explicit %s follow-ups without a VDA turn', async (_label, offset, status) => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'CHECKUP', title: 'Blood pressure review', dueDate: dateFromToday(offset) }];
    const result = await service.listForSession(tenantId, sessionId);
    expect(result.followUps).toHaveLength(1);
    expect(result.followUps[0]).toMatchObject({ status, dateSource: 'EXPLICIT', attendanceStatus: 'PENDING' });
    expect(attendance.save).not.toHaveBeenCalled();
  });

  it.each([
    ['clinical review', 'CLINICAL_REVIEW', 2],
    ['lab review', 'LAB_REVIEW', 3],
    ['checkup', 'CHECKUP', 6],
    ['medication review with an explicit source date', 'MEDICATION_REVIEW', 7],
  ] as const)('supports an explicit %s inside the reminder window', async (_label, type, offset) => {
    profile.clinicalProfile.scheduledEvents = [{ type, title: 'Source-backed review', dueDate: dateFromToday(offset) }];
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({
      followUps: [expect.objectContaining({ type, status: 'UPCOMING', dateSource: 'EXPLICIT' })],
    });
  });

  it.each([
    ['eight days away', 8],
    ['older than yesterday', -2],
  ])('hides %s', async (_label, offset) => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'CHECKUP', title: 'Review', dueDate: dateFromToday(offset) }];
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ followUps: [] });
  });

  it('offers exactly the next-day attendance workflow and persists only its answer', async () => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'CLINICAL_REVIEW', title: 'Diabetes review', dueDate: dateFromToday(-1), condition: 'Diabetes' }];
    const pending = await service.listForSession(tenantId, sessionId);
    expect(pending.followUps[0]).toMatchObject({ status: 'ATTENDANCE_CHECK', requiresAttendanceCheck: true });

    const response = await service.recordAttendance(tenantId, sessionId, pending.followUps[0].id, true);
    expect(response.attendanceStatus).toBe('COMPLETED');
    expect(attendance.save).toHaveBeenCalledWith(expect.objectContaining({ attendanceStatus: 'COMPLETED', patientRef }));
    expect(attendance.save).toHaveBeenCalledTimes(1);
  });

  it('records missed clinical review without a medication-adherence dependency', async () => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'MEDICATION_REVIEW', title: 'Medication review', dueDate: dateFromToday(-1) }];
    const followUp = (await service.listForSession(tenantId, sessionId)).followUps[0];
    const response = await service.recordAttendance(tenantId, sessionId, followUp.id, false);
    expect(response.attendanceStatus).toBe('MISSED');
    expect(response.message).toContain('care team');
    expect(attendance.save).toHaveBeenCalledWith(expect.objectContaining({ attendanceStatus: 'MISSED' }));
  });

  it('returns the original result safely for a duplicate attendance submission', async () => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'CHECKUP', title: 'Review', dueDate: dateFromToday(-1) }];
    const followUp = (await service.listForSession(tenantId, sessionId)).followUps[0];
    attendance.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'attendance-1', tenantId, patientRef, eventId: followUp.id, dueDate: followUp.dueDate, dateSource: 'EXPLICIT', attendanceStatus: 'COMPLETED', respondedAt: new Date(), createdAt: new Date() });
    await service.recordAttendance(tenantId, sessionId, followUp.id, true);
    await expect(service.recordAttendance(tenantId, sessionId, followUp.id, true)).resolves.toMatchObject({ attendanceStatus: 'COMPLETED' });
    expect(attendance.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a contradictory duplicate attendance submission', async () => {
    attendance.findOne.mockResolvedValue({ id: 'attendance-1', tenantId, patientRef, eventId: 'cfu_existing', dueDate: dateFromToday(-1), dateSource: 'EXPLICIT', attendanceStatus: 'COMPLETED', respondedAt: new Date(), createdAt: new Date() });
    await expect(service.recordAttendance(tenantId, sessionId, 'cfu_existing', false)).rejects.toMatchObject({ response: { message: 'FOLLOW_UP_ATTENDANCE_ALREADY_RECORDED' } });
  });

  it('does not re-ask after an attendance response exists', async () => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'CHECKUP', title: 'Review', dueDate: dateFromToday(-1) }];
    const first = await service.listForSession(tenantId, sessionId);
    attendance.find.mockResolvedValue([{
      id: 'attendance-1', tenantId, patientRef, eventId: first.followUps[0].id,
      dueDate: dateFromToday(-1), dateSource: 'EXPLICIT', attendanceStatus: 'COMPLETED',
      respondedAt: new Date(), createdAt: new Date(),
    }]);
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ followUps: [] });
  });

  it('uses a 30-day derived review only after a completed source encounter and labels it as derived', async () => {
    profile.clinicalProfile.encounters = [{ type: 'Hypertension', status: 'finished', end: dateFromToday(-29) }];
    const result = await service.listForSession(tenantId, sessionId);
    expect(result.followUps[0]).toMatchObject({ type: 'CLINICAL_REVIEW', status: 'DUE_TOMORROW', dateSource: 'DERIVED_30_DAY' });
  });

  it('hides a derived review that is beyond the seven-day reminder window', async () => {
    profile.clinicalProfile.encounters = [{ type: 'Hypertension', status: 'finished', end: dateFromToday(-21) }];
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ followUps: [] });
  });

  it('uses source-backed care-plan guidance for a missed follow-up when it is available', async () => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'CHECKUP', title: 'Review', dueDate: dateFromToday(-1), guidance: 'Please contact your hypertension clinic to reschedule the review.' }];
    const followUp = (await service.listForSession(tenantId, sessionId)).followUps[0];
    await expect(service.recordAttendance(tenantId, sessionId, followUp.id, false)).resolves.toMatchObject({
      message: 'Please contact your hypertension clinic to reschedule the review.',
    });
  });

  it('gives an explicit care-plan event priority over a derived encounter review', async () => {
    profile.clinicalProfile.encounters = [{ type: 'Hypertension', status: 'completed', end: dateFromToday(-29) }];
    profile.clinicalProfile.scheduledEvents = [{ type: 'CLINICAL_REVIEW', title: 'Planned review', dueDate: dateFromToday(3) }];
    const result = await service.listForSession(tenantId, sessionId);
    expect(result.followUps).toHaveLength(1);
    expect(result.followUps[0]).toMatchObject({ title: 'Planned review', dateSource: 'EXPLICIT' });
  });

  it('does not derive a follow-up from an uncompleted encounter or invalid date', async () => {
    profile.clinicalProfile.encounters = [
      { type: 'Review', status: 'planned', end: dateFromToday(-29) },
      { type: 'Review', status: 'completed', end: 'not-a-date' },
    ];
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ followUps: [] });
  });

  it('does not treat medication duration as a scheduled medication review', async () => {
    profile.clinicalProfile.medications = [{ name: 'Metformin', duration: '30 days', status: 'active' }];
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ followUps: [] });
  });

  it('returns explicit medication-review events only when a reliable source supplies a date', async () => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'MEDICATION_REVIEW', title: 'Prescription review', dueDate: dateFromToday(2), source: 'CARE_PLAN' }];
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ followUps: [expect.objectContaining({ type: 'MEDICATION_REVIEW', dateSource: 'EXPLICIT' })] });
  });

  it('keeps malformed explicit dates out of the patient response', async () => {
    profile.clinicalProfile.scheduledEvents = [{ type: 'CHECKUP', title: 'Invalid', dueDate: '2026-02-31' }];
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ followUps: [] });
  });

  it('uses the configured patient timezone for the date boundary', async () => {
    profile = record({ timezone: 'Pacific/Auckland' });
    patientData.getPatientByReference.mockResolvedValue(profile);
    profile.clinicalProfile.scheduledEvents = [{ type: 'CHECKUP', title: 'Timezone review', dueDate: '2026-09-09' }];
    jest.spyOn(service as unknown as { now: () => Date }, 'now').mockReturnValue(new Date('2026-09-08T12:30:00Z'));
    await expect(service.listForSession(tenantId, sessionId)).resolves.toMatchObject({ asOfDate: '2026-09-09', followUps: [expect.objectContaining({ status: 'DUE_TODAY' })] });
  });

  it('does not expose another tenant session', async () => {
    sessions.findOne.mockResolvedValue(null);
    await expect(service.listForSession('00000000-0000-0000-0000-000000000099', sessionId)).rejects.toMatchObject({ response: { message: 'SESSION_NOT_FOUND' } });
  });
});
