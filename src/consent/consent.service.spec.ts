/**
 * VDA Backend — Consent Service Unit Tests (P1 Core Business)
 *
 * Tests consent validation including tenant ownership, subject association,
 * active status verification, and scope enforcement.
 */
import { ConsentService } from './consent.service';
import { ForbiddenException } from '@nestjs/common';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { Repository } from 'typeorm';

describe('ConsentService', () => {
  let service: ConsentService;
  let mockConsentRepo: jest.Mocked<Repository<ConsentArtifact>>;

  const validConsent: Partial<ConsentArtifact> = {
    id: 'consent-001',
    tenantId: 'tenant-001',
    subjectId: 'subject-001',
    status: 'ACTIVE',
    scopes: ['read:records', 'write:observations', 'read:medications'],
  };

  beforeEach(() => {
    mockConsentRepo = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<ConsentArtifact>>;

    service = new ConsentService(mockConsentRepo);
  });

  // ─── Valid consent ────────────────────────────────────
  describe('Valid consent', () => {
    it('should return consent artifact when all checks pass', async () => {
      mockConsentRepo.findOne.mockResolvedValue(validConsent as ConsentArtifact);

      const result = await service.validateConsent('consent-001', 'tenant-001', 'subject-001');
      expect(result).toEqual(validConsent);
    });

    it('should validate with matching scopes', async () => {
      mockConsentRepo.findOne.mockResolvedValue(validConsent as ConsentArtifact);

      const result = await service.validateConsent(
        'consent-001', 'tenant-001', 'subject-001',
        ['read:records', 'write:observations']
      );
      expect(result).toEqual(validConsent);
    });

    it('should validate when no required scopes specified', async () => {
      mockConsentRepo.findOne.mockResolvedValue(validConsent as ConsentArtifact);

      const result = await service.validateConsent('consent-001', 'tenant-001', 'subject-001', []);
      expect(result).toEqual(validConsent);
    });
  });

  // ─── Missing consent ──────────────────────────────────
  describe('Missing consent', () => {
    it('should throw CONSENT_MISSING when consent artifact not found', async () => {
      mockConsentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.validateConsent('nonexistent', 'tenant-001', 'subject-001')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Tenant ownership ─────────────────────────────────
  describe('Tenant isolation', () => {
    it('should throw CONSENT_MISSING when tenant does not match', async () => {
      mockConsentRepo.findOne.mockResolvedValue(validConsent as ConsentArtifact);

      await expect(
        service.validateConsent('consent-001', 'wrong-tenant', 'subject-001')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Subject association ──────────────────────────────
  describe('Subject association', () => {
    it('should throw CONSENT_MISSING when subject does not match', async () => {
      mockConsentRepo.findOne.mockResolvedValue(validConsent as ConsentArtifact);

      await expect(
        service.validateConsent('consent-001', 'tenant-001', 'wrong-subject')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Consent status ───────────────────────────────────
  describe('Consent status enforcement', () => {
    it('should throw CONSENT_MISSING when consent is WITHDRAWN', async () => {
      const withdrawn = { ...validConsent, status: 'WITHDRAWN' };
      mockConsentRepo.findOne.mockResolvedValue(withdrawn as ConsentArtifact);

      await expect(
        service.validateConsent('consent-001', 'tenant-001', 'subject-001')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw CONSENT_MISSING when consent is EXPIRED', async () => {
      const expired = { ...validConsent, status: 'EXPIRED' };
      mockConsentRepo.findOne.mockResolvedValue(expired as ConsentArtifact);

      await expect(
        service.validateConsent('consent-001', 'tenant-001', 'subject-001')
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Scope enforcement ────────────────────────────────
  describe('Scope enforcement', () => {
    it('should throw CONSENT_MISSING when required scope is not granted', async () => {
      mockConsentRepo.findOne.mockResolvedValue(validConsent as ConsentArtifact);

      await expect(
        service.validateConsent('consent-001', 'tenant-001', 'subject-001', ['admin:delete'])
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw when one of multiple required scopes is missing', async () => {
      mockConsentRepo.findOne.mockResolvedValue(validConsent as ConsentArtifact);

      await expect(
        service.validateConsent('consent-001', 'tenant-001', 'subject-001',
          ['read:records', 'admin:delete'])
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
