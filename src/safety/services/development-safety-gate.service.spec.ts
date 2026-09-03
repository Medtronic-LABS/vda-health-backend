import { DevelopmentSafetyGate } from './development-safety-gate.service';

describe('DevelopmentSafetyGate medication actions', () => {
  const service = new DevelopmentSafetyGate();

  it.each([
    'Can I increase my dose?',
    'I want to stop taking my medication.',
    'Should I start a new medicine?',
  ])('withholds an English medication-change request: %s', async (input) => {
    const result = await service.evaluateSafety(input, 'test-correlation-id', 'en');

    expect(result.status).toBe('WITHHOLD');
    expect(result.ruleId).toBe('MEDICATION_01');
  });
});
