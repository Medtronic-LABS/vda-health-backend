/**
 * VDA Backend — PII Protection Service Unit Tests (P0 Critical)
 *
 * Tests the DevelopmentPiiProtectionService deterministic PII detection
 * for all 10 PII categories: ABHA number, ABHA address, Aadhaar, PAN,
 * phone, email, name (EN/HI), address (EN/HI), reference ID.
 */
import { DevelopmentPiiProtectionService } from './services/development-pii-protection.service';

describe('DevelopmentPiiProtectionService', () => {
  let service: DevelopmentPiiProtectionService;

  beforeEach(() => {
    service = new DevelopmentPiiProtectionService();
  });

  // ─── Empty / null input ───────────────────────────────
  describe('Edge cases', () => {
    it('should handle empty string input', async () => {
      const result = await service.sanitizeText('');
      expect(result.sanitizedText).toBe('');
      expect(result.piiDetected).toBe(false);
      expect(result.detectedPiiCategories).toEqual([]);
      expect(result.status).toBe('SUCCESS');
    });

    it('should handle text with no PII', async () => {
      const result = await service.sanitizeText('What is my blood sugar level?');
      expect(result.piiDetected).toBe(false);
      expect(result.sanitizedText).toBe('What is my blood sugar level?');
    });
  });

  // ─── ABHA Number ──────────────────────────────────────
  describe('ABHA Number detection', () => {
    it('should detect and redact ABHA number (XX-XXXX-XXXX-XXXX format)', async () => {
      const result = await service.sanitizeText('My ABHA number is 91-1234-5678-9012');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('abha_number');
      expect(result.sanitizedText).toContain('[ABHA_NUMBER_REDACTED]');
      expect(result.sanitizedText).not.toContain('91-1234-5678-9012');
    });
  });

  // ─── ABHA Address ─────────────────────────────────────
  describe('ABHA Address detection', () => {
    it('should detect and redact ABHA address (@sbx)', async () => {
      const result = await service.sanitizeText('My ABHA address is user123@sbx');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('abha_address');
      expect(result.sanitizedText).toContain('[ABHA_ADDRESS_REDACTED]');
    });

    it('should detect ABHA address (@abdm)', async () => {
      const result = await service.sanitizeText('Contact me at test.user@abdm');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('abha_address');
    });
  });

  // ─── Aadhaar Number ───────────────────────────────────
  describe('Aadhaar Number detection', () => {
    it('should detect 12-digit Aadhaar (with spaces)', async () => {
      const result = await service.sanitizeText('My Aadhaar is 1234 5678 9012');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('aadhaar');
      expect(result.sanitizedText).toContain('[AADHAAR_REDACTED]');
      expect(result.sanitizedText).not.toContain('1234 5678 9012');
    });

    it('should detect 12-digit Aadhaar (without spaces)', async () => {
      const result = await service.sanitizeText('Aadhaar: 123456789012');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('aadhaar');
    });
  });

  // ─── PAN Number ───────────────────────────────────────
  describe('PAN Number detection', () => {
    it('should detect PAN card number', async () => {
      const result = await service.sanitizeText('My PAN is ABCDE1234F');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('pan');
      expect(result.sanitizedText).toContain('[PAN_REDACTED]');
      expect(result.sanitizedText).not.toContain('ABCDE1234F');
    });

    it('should detect lowercase PAN', async () => {
      const result = await service.sanitizeText('PAN: abcde1234f');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('pan');
    });
  });

  // ─── Phone Number ─────────────────────────────────────
  describe('Phone Number detection', () => {
    it('should detect Indian mobile number (10 digits)', async () => {
      const result = await service.sanitizeText('Call me at 9876543210');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('phone');
      expect(result.sanitizedText).toContain('[PHONE_REDACTED]');
    });

    it('should detect number with +91 prefix', async () => {
      const result = await service.sanitizeText('My number is +91 9876543210');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('phone');
    });

    it('should detect number with +91- prefix', async () => {
      const result = await service.sanitizeText('Contact: +91-8765432109');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('phone');
    });

    it('should NOT flag numbers starting with 0-5', async () => {
      const result = await service.sanitizeText('Reference number 1234567890');
      // Indian mobile numbers start with 6-9
      expect(result.detectedPiiCategories).not.toContain('phone');
    });
  });

  // ─── Email ────────────────────────────────────────────
  describe('Email detection', () => {
    it('should detect email address', async () => {
      const result = await service.sanitizeText('Send reports to patient@gmail.com');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('email');
      expect(result.sanitizedText).toContain('[EMAIL_REDACTED]');
      expect(result.sanitizedText).not.toContain('patient@gmail.com');
    });

    it('should detect email with subdomain', async () => {
      const result = await service.sanitizeText('Contact user@health.gov.in');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('email');
    });
  });

  // ─── Name (English) ───────────────────────────────────
  describe('Name detection (English)', () => {
    it('should detect "My name is X"', async () => {
      const result = await service.sanitizeText('My name is Ramesh Kumar');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('name');
      expect(result.sanitizedText).toContain('[NAME_REDACTED]');
    });

    it('should detect "I am X"', async () => {
      const result = await service.sanitizeText('I am Priya Sharma');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('name');
    });

    it('should detect "Call me X"', async () => {
      const result = await service.sanitizeText('Call me Ankit');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('name');
    });
  });

  // ─── Name (Hindi) ─────────────────────────────────────
  describe('Name detection (Hindi/Hinglish)', () => {
    it('should detect "mera naam X" pattern', async () => {
      const result = await service.sanitizeText('mera naam Rahul hai');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('name_hindi');
    });

    it('should detect "main X hoon" pattern', async () => {
      const result = await service.sanitizeText('main Suresh hoon');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('name_hindi');
    });
  });

  // ─── Address ──────────────────────────────────────────
  describe('Address detection', () => {
    it('should detect "resident of X" pattern (English)', async () => {
      const result = await service.sanitizeText('I am a resident of Delhi');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('address');
    });

    it('should detect "living in X" pattern', async () => {
      const result = await service.sanitizeText('I am living in Mumbai');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('address');
    });

    it('should detect Hindi address pattern "ka nivasi"', async () => {
      const result = await service.sanitizeText('Delhi ka nivasi hoon');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('address_hindi');
    });
  });

  // ─── Reference IDs ────────────────────────────────────
  describe('Reference ID detection', () => {
    it('should detect REF-XXXXX pattern', async () => {
      const result = await service.sanitizeText('My reference is REF-12345678');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('reference_id');
      expect(result.sanitizedText).toContain('[REF_ID_REDACTED]');
    });

    it('should detect PAT-XXXX pattern', async () => {
      const result = await service.sanitizeText('Patient ID: PAT-9876');
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories).toContain('reference_id');
    });
  });

  // ─── Multiple PII categories ──────────────────────────
  describe('Multiple PII in single text', () => {
    it('should detect multiple PII categories in one string', async () => {
      const input = 'My name is Ramesh Kumar, email is ramesh@test.com, phone 9876543210, Aadhaar 1234 5678 9012';
      const result = await service.sanitizeText(input);
      expect(result.piiDetected).toBe(true);
      expect(result.detectedPiiCategories.length).toBeGreaterThanOrEqual(3);
      expect(result.sanitizedText).not.toContain('ramesh@test.com');
      expect(result.sanitizedText).not.toContain('9876543210');
      expect(result.sanitizedText).not.toContain('1234 5678 9012');
    });
  });

  // ─── Language detection ────────────────────────────────
  describe('Language detection', () => {
    it('should detect Hindi from Devanagari script', async () => {
      const result = await service.sanitizeText('मेरा नाम रमेश है');
      expect(result.language).toBe('hi');
    });

    it('should detect Hinglish from romanized Hindi keywords', async () => {
      const result = await service.sanitizeText('mera naam hai Rahul');
      expect(result.language).toBe('hi-Latn');
    });

    it('should default to English for plain English text', async () => {
      const result = await service.sanitizeText('What is diabetes?');
      expect(result.language).toBe('en');
    });

    it('should use localeHint when no script indicators present', async () => {
      const result = await service.sanitizeText('Hello there', 'ta');
      expect(result.language).toBe('ta');
    });
  });

  // ─── Redaction metadata ────────────────────────────────
  describe('Redaction metadata', () => {
    it('should include matched values in redactionMetadata', async () => {
      const result = await service.sanitizeText('My PAN is ABCDE1234F');
      expect(result.redactionMetadata).toBeDefined();
      expect(result.redactionMetadata['pan']).toBeDefined();
      expect(result.redactionMetadata['pan']).toContainEqual(expect.stringMatching(/ABCDE1234F/i));
    });
  });
});
