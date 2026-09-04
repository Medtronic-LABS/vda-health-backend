/**
 * VDA Backend — Safety Gate Service Unit Tests (P0 Critical)
 *
 * Tests the DevelopmentSafetyGate deterministic safety evaluation
 * against emergency, self-harm, medication, invalid-input, and safe categories
 * in English, Hindi, and Hinglish.
 */
import { DevelopmentSafetyGate } from './services/development-safety-gate.service';

describe('DevelopmentSafetyGate', () => {
  let gate: DevelopmentSafetyGate;
  const correlationId = 'test-corr-001';

  beforeEach(() => {
    gate = new DevelopmentSafetyGate();
  });

  // ─── INVALID_INPUT ────────────────────────────────────
  describe('INVALID_INPUT detection', () => {
    it('should reject empty string', async () => {
      const result = await gate.evaluateSafety('', correlationId);
      expect(result.status).toBe('INVALID_INPUT');
      expect(result.ruleId).toBe('INVALID_INPUT_01');
      expect(result.action).toBe('REJECT');
    });

    it('should reject whitespace-only input', async () => {
      const result = await gate.evaluateSafety('   ', correlationId);
      expect(result.status).toBe('INVALID_INPUT');
    });

    it('should reject single character input', async () => {
      const result = await gate.evaluateSafety('a', correlationId);
      expect(result.status).toBe('INVALID_INPUT');
    });

    it('should reject repetitive nonsense (e.g. "aaaaaaa")', async () => {
      const result = await gate.evaluateSafety('aaaaaaaaa', correlationId);
      expect(result.status).toBe('INVALID_INPUT');
      expect(result.ruleId).toBe('INVALID_INPUT_01');
    });

    it('should NOT reject valid short text (e.g. "hi")', async () => {
      const result = await gate.evaluateSafety('hi', correlationId);
      expect(result.status).not.toBe('INVALID_INPUT');
    });
  });

  // ─── EMERGENCY detection ──────────────────────────────
  describe('EMERGENCY detection (English)', () => {
    const emergencyPhrases = [
      'I have severe chest pain',
      'difficulty breathing right now',
      'my father is unconscious',
      'there is severe bleeding from wound',
      'patient showing stroke indicators',
      'I think this is a stroke',
    ];

    it.each(emergencyPhrases)('should ESCALATE for "%s"', async (phrase) => {
      const result = await gate.evaluateSafety(phrase, correlationId, 'en');
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('EMERGENCY_01');
      expect(result.severity).toBe('HIGH');
      expect(result.action).toBe('ESCALATE');
      expect(result.language).toBe('en');
      expect(result.patientSafeMessage).toContain('emergency');
    });
  });

  describe('EMERGENCY detection (Hindi)', () => {
    const hindiEmergencyPhrases = [
      'मुझे सीने में बहुत तेज़ दर्द है',
      'छाती में दर्द हो रहा है',
      'सांस लेने में बहुत दिक्कत',
      'सांस फूल रही है',
      'बेहोश हो गया',
    ];

    it.each(hindiEmergencyPhrases)('should ESCALATE for "%s"', async (phrase) => {
      const result = await gate.evaluateSafety(phrase, correlationId, 'hi');
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('EMERGENCY_01');
      expect(result.language).toBe('hi');
      expect(result.patientSafeMessage).toBeTruthy();
    });
  });

  describe('EMERGENCY detection (Hinglish)', () => {
    const hinglishEmergencyPhrases = [
      'seene mein bahut tez dard hai',
      'chest me pain ho raha hai',
      'saans lene mein bahut dikkat',
      'behosh ho gaya',
      'bahut zyada khoon beh raha hai',
      'stroke ke lakshan dikh rahe hain',
    ];

    it.each(hinglishEmergencyPhrases)('should ESCALATE for "%s"', async (phrase) => {
      const result = await gate.evaluateSafety(phrase, correlationId);
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('EMERGENCY_01');
    });
  });

  // ─── SELF_HARM detection ──────────────────────────────
  describe('SELF_HARM detection', () => {
    it('should ESCALATE for "I want to kill myself" (English)', async () => {
      const result = await gate.evaluateSafety('I want to kill myself', correlationId, 'en');
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('SELF_HARM_01');
      expect(result.severity).toBe('HIGH');
      expect(result.patientSafeMessage).toContain('self-harm');
    });

    it('should ESCALATE for "suicide" (English)', async () => {
      const result = await gate.evaluateSafety('I am thinking about suicide', correlationId, 'en');
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('SELF_HARM_01');
    });

    it('should ESCALATE for "आत्महत्या" (Hindi)', async () => {
      const result = await gate.evaluateSafety('मैं आत्महत्या करना चाहता हूँ', correlationId, 'hi');
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('SELF_HARM_01');
      expect(result.language).toBe('hi');
    });

    it('should ESCALATE for "khud ko marna" (Hinglish)', async () => {
      const result = await gate.evaluateSafety('main khud ko marna chahta hoon', correlationId);
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('SELF_HARM_01');
    });

    it('should ESCALATE for "end my life" (English)', async () => {
      const result = await gate.evaluateSafety('I want to end my life', correlationId, 'en');
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('SELF_HARM_01');
    });

    it('should ESCALATE for "jaan de dunga" (Hinglish)', async () => {
      const result = await gate.evaluateSafety('main jaan de dunga', correlationId);
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('SELF_HARM_01');
    });
  });

  // ─── MEDICATION detection ─────────────────────────────
  describe('MEDICATION detection', () => {
    const medicationPhrases = [
      { text: 'Can I increase my dose?', lang: 'en' },
      { text: 'I want to stop my medication', lang: 'en' },
      { text: 'Should I start a new medicine?', lang: 'en' },
      { text: 'I am taking double the dose', lang: 'en' },
      { text: 'Can I self-medicate for this?', lang: 'en' },
      { text: 'Should I adjust my dosage?', lang: 'en' },
    ];

    it.each(medicationPhrases)('should WITHHOLD for "$text" ($lang)', async ({ text, lang }) => {
      const result = await gate.evaluateSafety(text, correlationId, lang);
      expect(result.status).toBe('WITHHOLD');
      expect(result.ruleId).toBe('MEDICATION_01');
      expect(result.severity).toBe('MEDIUM');
      expect(result.action).toBe('WITHHOLD');
    });

    it('should WITHHOLD for Hindi medication request', async () => {
      const result = await gate.evaluateSafety('मुझे दवा बढ़ाना है', correlationId, 'hi');
      expect(result.status).toBe('WITHHOLD');
      expect(result.ruleId).toBe('MEDICATION_01');
      expect(result.language).toBe('hi');
    });

    it('should WITHHOLD for Hinglish medication request', async () => {
      const result = await gate.evaluateSafety('dose increase karna hai', correlationId);
      expect(result.status).toBe('WITHHOLD');
      expect(result.ruleId).toBe('MEDICATION_01');
    });
  });

  // ─── SAFE inputs ──────────────────────────────────────
  describe('SAFE inputs (no red flags)', () => {
    const safePhrases = [
      'What is my blood sugar level?',
      'Tell me about PM-JAY scheme',
      'Where is the nearest hospital?',
      'मेरा शुगर लेवल क्या है?',
      'How much water should I drink?',
      'I had a good day today',
      'Please show me my records',
    ];

    it.each(safePhrases)('should return SAFE for "%s"', async (phrase) => {
      const result = await gate.evaluateSafety(phrase, correlationId);
      expect(result.status).toBe('SAFE');
      expect(result.ruleId).toBeNull();
      expect(result.severity).toBeNull();
      expect(result.action).toBeNull();
      expect(result.patientSafeMessage).toBeNull();
    });
  });

  // ─── Priority ordering ────────────────────────────────
  describe('Priority ordering: EMERGENCY > SELF_HARM > MEDICATION', () => {
    it('should prioritize EMERGENCY over MEDICATION keywords', async () => {
      const result = await gate.evaluateSafety('I have severe chest pain and want to change dose', correlationId);
      expect(result.status).toBe('ESCALATION_REQUIRED');
      expect(result.ruleId).toBe('EMERGENCY_01');
    });

    it('should prioritize INVALID_INPUT over everything for empty text', async () => {
      const result = await gate.evaluateSafety('', correlationId, 'en');
      expect(result.status).toBe('INVALID_INPUT');
    });
  });

  // ─── Language detection ────────────────────────────────
  describe('Automatic language detection', () => {
    it('should auto-detect Hindi from Devanagari script', async () => {
      const result = await gate.evaluateSafety('सीने में दर्द है', correlationId);
      expect(result.language).toBe('hi');
    });

    it('should auto-detect Hinglish from romanized Hindi', async () => {
      const result = await gate.evaluateSafety('seene mein bahut tez dard hai', correlationId);
      expect(result.language).toMatch(/hi-Latn|hi/);
    });

    it('should default to English for English text', async () => {
      const result = await gate.evaluateSafety('What is diabetes?', correlationId);
      expect(result.language).toBe('en');
    });
  });

  // ─── Correlation ID passthrough ────────────────────────
  describe('Correlation ID', () => {
    it('should preserve correlationId in all responses', async () => {
      const customCorrelationId = 'my-custom-corr-id-xyz';
      const safeResult = await gate.evaluateSafety('hello', customCorrelationId);
      expect(safeResult.correlationId).toBe(customCorrelationId);

      const escalationResult = await gate.evaluateSafety('severe chest pain', customCorrelationId);
      expect(escalationResult.correlationId).toBe(customCorrelationId);
    });
  });
});
