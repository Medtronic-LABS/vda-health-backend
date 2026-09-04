/**
 * VDA Backend — Audit Service Unit Tests (P1 Core Business)
 *
 * Tests the AuditService for HMAC-based subject hashing, immutable
 * audit event logging, and correlation ID passthrough.
 */
import { AuditService } from './audit.service';
import { AuditEvent } from '../database/entities/audit-event.entity';
import { ConfigurationService } from '../configuration/configuration.service';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

describe('AuditService', () => {
  let service: AuditService;
  let mockAuditRepo: jest.Mocked<Repository<AuditEvent>>;
  let mockConfigService: jest.Mocked<ConfigurationService>;

  beforeEach(() => {
    mockAuditRepo = {
      save: jest.fn().mockImplementation((event) => Promise.resolve({ ...event, id: 'audit-001' })),
    } as unknown as jest.Mocked<Repository<AuditEvent>>;

    mockConfigService = {
      auditHmacKeyId: 'v1',
      auditHmacSecret: 'test-secret-key-123',
    } as unknown as jest.Mocked<ConfigurationService>;

    service = new AuditService(mockAuditRepo, mockConfigService);
  });

  // ─── HMAC Subject Hashing ─────────────────────────────
  describe('hashSubject', () => {
    it('should produce consistent HMAC hash for the same input', () => {
      const result1 = service.hashSubject('patient-abha-123');
      const result2 = service.hashSubject('patient-abha-123');

      expect(result1.hash).toBe(result2.hash);
      expect(result1.keyId).toBe('v1');
    });

    it('should produce different hashes for different inputs', () => {
      const result1 = service.hashSubject('patient-abha-123');
      const result2 = service.hashSubject('patient-abha-456');

      expect(result1.hash).not.toBe(result2.hash);
    });

    it('should produce a valid SHA-256 hex hash (64 chars)', () => {
      const result = service.hashSubject('test-subject');
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should match manually computed HMAC-SHA256', () => {
      const expected = crypto
        .createHmac('sha256', 'test-secret-key-123')
        .update('test-input')
        .digest('hex');

      const result = service.hashSubject('test-input');
      expect(result.hash).toBe(expected);
    });

    it('should use fallback values when config is empty', () => {
      const fallbackConfig = {
        auditHmacKeyId: undefined,
        auditHmacSecret: undefined,
      } as unknown as jest.Mocked<ConfigurationService>;
      const fallbackService = new AuditService(mockAuditRepo, fallbackConfig);

      const result = fallbackService.hashSubject('test');
      expect(result.keyId).toBe('v1'); // default fallback
      expect(result.hash).toBeTruthy();
    });
  });

  // ─── Audit Event Logging ──────────────────────────────
  describe('logEvent', () => {
    const eventParams = {
      tenantId: 'tenant-001',
      subjectAbhaRef: 'patient-abha-ref',
      actingPrincipal: 'user-ext-001',
      correlationId: 'corr-001',
      action: 'session_created',
      entityName: 'session',
      entityId: 'session-001',
      details: { locale: 'hi' },
    };

    it('should create and save audit event with hashed subject', async () => {
      await service.logEvent(eventParams);

      expect(mockAuditRepo.save).toHaveBeenCalledTimes(1);
      const savedEvent = mockAuditRepo.save.mock.calls[0][0] as AuditEvent;
      expect(savedEvent.tenantId).toBe('tenant-001');
      expect(savedEvent.subjectAbhaRefHash).toBeTruthy();
      expect(savedEvent.subjectAbhaRefHash).not.toBe('patient-abha-ref'); // hashed, not raw
      expect(savedEvent.actingPrincipal).toBe('user-ext-001');
      expect(savedEvent.action).toBe('session_created');
      expect(savedEvent.entityName).toBe('session');
      expect(savedEvent.entityId).toBe('session-001');
      expect(savedEvent.details).toEqual({ locale: 'hi' });
      expect(savedEvent.hmacKeyId).toBe('v1');
    });

    it('should handle null optional fields', async () => {
      await service.logEvent({
        ...eventParams,
        speaker: null,
        entityId: null,
        details: null,
      });

      const savedEvent = mockAuditRepo.save.mock.calls[0][0] as AuditEvent;
      expect(savedEvent.speaker).toBeNull();
      expect(savedEvent.entityId).toBeNull();
      expect(savedEvent.details).toBeNull();
    });

    it('should include speaker when provided', async () => {
      await service.logEvent({
        ...eventParams,
        speaker: 'PATIENT',
      });

      const savedEvent = mockAuditRepo.save.mock.calls[0][0] as AuditEvent;
      expect(savedEvent.speaker).toBe('PATIENT');
    });

    it('should propagate correlationId for tracing', async () => {
      await service.logEvent({
        ...eventParams,
        correlationId: 'trace-abc-123',
      });

      const savedEvent = mockAuditRepo.save.mock.calls[0][0] as AuditEvent;
      expect(savedEvent.correlationId).toBe('trace-abc-123');
    });

    it('should return the saved event', async () => {
      const result = await service.logEvent(eventParams);
      expect(result).toBeDefined();
      expect(result.id).toBe('audit-001');
    });
  });
});
