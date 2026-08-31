import { EscalationService } from './escalation.service';
import { ClinicalEscalation } from '../database/entities/clinical-escalation.entity';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';

describe('EscalationService', () => {
  const repo = {
    create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: 'escalation-1', ...value })),
    findOne: jest.fn(), count: jest.fn(), find: jest.fn(),
  };
  const turnRepo = {
    create: jest.fn((value) => value), save: jest.fn(async (value) => value),
    findOne: jest.fn(), count: jest.fn(), find: jest.fn(),
  };
  const audit = { hashSubject: jest.fn(() => ({ hash: 'subject-hash', keyId: 'v1' })), logEvent: jest.fn(async () => undefined) };
  const identity = { tenantId: '00000000-0000-0000-0000-000000000000', externalId: 'reviewer', scopes: [] } as any;
  const turn = { id: '00000000-0000-0000-0000-000000000001', subjectRef: 'synthetic:patient', speaker: 'self', conversationRetentionGranted: true } as ConversationTurn;

  beforeEach(() => jest.clearAllMocks());

  it('persists an existing high-severity safety escalation as an open T1 record without raw input', async () => {
    const service = new EscalationService(repo as any, turnRepo as any, audit as any);
    await service.createFromSafety({ identity, turn, sanitizedInputText: '[REDACTED_PHONE]', safety: {
      status: 'ESCALATION_REQUIRED', ruleId: 'EMERGENCY_01', ruleVersion: '1.0', severity: 'HIGH', action: 'ESCALATE',
      patientSafeMessage: 'Seek emergency care.', correlationId: 'corr-1', language: 'en',
    } });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tier: 'T1', status: 'OPEN', ruleId: 'EMERGENCY_01', sanitizedInputText: '[REDACTED_PHONE]' }));
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'clinical_escalation_created', details: expect.not.objectContaining({ input: expect.anything() }) }));
  });

  it('keeps the input unavailable when conversation retention is not granted', async () => {
    const service = new EscalationService(repo as any, turnRepo as any, audit as any);
    await service.createFromSafety({ identity, turn: { ...turn, conversationRetentionGranted: false }, sanitizedInputText: '[REDACTED_PHONE]', safety: {
      status: 'ESCALATION_REQUIRED', ruleId: 'SELF_HARM_01', ruleVersion: '1.0', severity: 'HIGH', action: 'ESCALATE',
      patientSafeMessage: 'Seek immediate help.', correlationId: 'corr-2', language: 'en',
    } });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ sanitizedInputText: null }));
  });

  it('records a review outcome and its operational audit event', async () => {
    const escalation = Object.assign(new ClinicalEscalation(), { id: 'escalation-1', tenantId: identity.tenantId, subjectRefHash: 'subject-hash', correlationId: 'corr-3', ruleId: 'EMERGENCY_01', tier: 'T1', status: 'OPEN', reviewHistory: [] });
    repo.findOne.mockResolvedValue(escalation);
    const service = new EscalationService(repo as any, turnRepo as any, audit as any);
    const saved = await service.review(identity.tenantId, 'escalation-1', identity, 'TRUE_POSITIVE', 'Reviewed operationally');
    expect(saved.status).toBe('TRUE_POSITIVE');
    expect(saved.reviewOutcome).toBe('TRUE_POSITIVE');
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'clinical_escalation_reviewed' }));
  });
});
