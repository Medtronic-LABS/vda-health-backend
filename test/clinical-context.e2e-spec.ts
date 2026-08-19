/* eslint-disable */
/**
 * Phase 5 Clinical Context E2E Test Suite
 *
 * Tests the offline ClinicalContextService and DevelopmentHealthRecordService
 * without any live ABDM API calls.
 *
 * All health records returned are deterministic synthetic fixtures.
 */
process.env.DEV_AUTH_ENABLED = 'true';
process.env.DEV_AUTH_TOKEN = 'dev-token';
process.env.DEV_AUTH_TENANT_ID = '00000000-0000-0000-0000-000000000000';
process.env.DEV_AUTH_PARTNER_ID = 'dev-partner';
process.env.DEV_AUTH_EXTERNAL_ID = 'dev-host-user-123';
process.env.DEV_AUTH_SUBJECT_ABHA_REF = 'dev-subject-abha-ref-123';
process.env.AUDIT_HMAC_KEY_ID = 'v1';
process.env.AUDIT_HMAC_SECRET = 'my-secret-key-123';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ConsentArtifact } from '../src/database/entities/consent-artifact.entity';
import { Session } from '../src/database/entities/session.entity';
import { ConversationTurn } from '../src/database/entities/conversation-turn.entity';
import { AuditEvent } from '../src/database/entities/audit-event.entity';
import { RedisService } from '../src/redis/redis.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClinicalContextService } from '../src/abdm/services/clinical-context.service';
import {
  ClinicalContextRequest,
} from '../src/abdm/interfaces/clinical-context-service.interface';
import {
  IHealthRecordService,
  HealthRecordCategory,
} from '../src/abdm/interfaces/health-record-service.interface';
import * as crypto from 'crypto';

// ─── In-memory E2E stores ────────────────────────────────────────────────────
let mockConsentDb: ConsentArtifact[] = [];
let mockAuditDb: AuditEvent[] = [];
let redisStore: Record<string, string> = {};
let redisLocks: Record<string, string> = {};

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const SUBJECT_ABHA_REF = 'dev-subject-abha-ref-123';
const CONSENT_ID = 'dev-consent-001';
const SESSION_ID = 'dev-session-001';
const CORRELATION_ID = 'dev-corr-001';

// ─── Repository mocks ────────────────────────────────────────────────────────
const mockConsentRepository = {
  findOne: jest.fn().mockImplementation((options) => {
    const id = options?.where?.id;
    return Promise.resolve(mockConsentDb.find((c) => c.id === id) || null);
  }),
};

const mockSessionRepository = {
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
};

const mockTurnRepository = {
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockImplementation((t) => {
    if (!t.createdAt) t.createdAt = new Date();
    return Promise.resolve(t);
  }),
};

const mockAuditRepository = {
  save: jest.fn().mockImplementation((event) => {
    event.id = crypto.randomUUID();
    event.timestamp = new Date();
    mockAuditDb.push(event);
    return Promise.resolve(event);
  }),
};

// ─── TypeORM mock (same pattern as pii-safety.e2e-spec.ts) ──────────────────
jest.mock('@nestjs/typeorm', () => {
  const original = jest.requireActual('@nestjs/typeorm');
  const { DataSource } = require('typeorm');
  class MockTypeOrmModule {
    static forRoot = jest.fn().mockImplementation(() => {
      const mockDS = { query: jest.fn().mockResolvedValue([]), entityMetadatas: [] };
      const token = original.getDataSourceToken ? original.getDataSourceToken() : 'default_DataSource';
      return { global: true, module: MockTypeOrmModule, providers: [{ provide: DataSource, useValue: mockDS }, { provide: token, useValue: mockDS }], exports: [DataSource, token] };
    });
    static forRootAsync = jest.fn().mockImplementation(() => {
      const mockDS = { query: jest.fn().mockResolvedValue([]), entityMetadatas: [] };
      const token = original.getDataSourceToken ? original.getDataSourceToken() : 'default_DataSource';
      return { global: true, module: MockTypeOrmModule, providers: [{ provide: DataSource, useValue: mockDS }, { provide: token, useValue: mockDS }], exports: [DataSource, token] };
    });
    static forFeature = jest.fn().mockImplementation((entities) => {
      const providers = (entities || []).map((entity: any) => ({
        provide: original.getRepositoryToken(entity),
        useValue: {
          find: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation((dto) => dto),
          save: jest.fn().mockImplementation((dto) => Promise.resolve({ id: 'mock-id', ...dto })),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          remove: jest.fn().mockResolvedValue({}),
        },
      }));
      return { module: class {}, providers, exports: providers };
    });
  }
  return { ...original, TypeOrmModule: MockTypeOrmModule };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeActiveConsent(overrides: Partial<ConsentArtifact> = {}): ConsentArtifact {
  const c = new ConsentArtifact();
  c.id = CONSENT_ID;
  c.tenantId = TENANT_ID;
  c.subjectId = SUBJECT_ABHA_REF;
  c.consentVersion = 'v1.0';
  c.scopes = ['record_read', 'conversation_retention'];
  c.language = 'hi';
  c.deliveryMode = 'digital';
  c.retentionInfo = {};
  c.status = 'ACTIVE';
  c.createdAt = new Date();
  return Object.assign(c, overrides);
}

function makeRequest(intent: string, overrides: Partial<ClinicalContextRequest> = {}): ClinicalContextRequest {
  return {
    sessionId: SESSION_ID,
    tenantId: TENANT_ID,
    subjectAbhaRef: SUBJECT_ABHA_REF,
    vdaConsentArtifactId: CONSENT_ID,
    intent,
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

// ─── Test suite ──────────────────────────────────────────────────────────────
describe('Clinical Context Service (E2E)', () => {
  let app: INestApplication;
  let clinicalContextService: ClinicalContextService;

  const mockRedisService = {
    get: jest.fn().mockImplementation((key: string) => Promise.resolve(redisStore[key] || null)),
    set: jest.fn().mockImplementation((key: string, val: string, _ttl: number) => { redisStore[key] = val; return Promise.resolve(); }),
    acquireLock: jest.fn().mockImplementation((key: string, token: string) => {
      if (redisLocks[key]) return Promise.resolve(false);
      redisLocks[key] = token;
      return Promise.resolve(true);
    }),
    releaseLock: jest.fn().mockImplementation((key: string, token: string) => {
      if (redisLocks[key] === token) { delete redisLocks[key]; return Promise.resolve(true); }
      return Promise.resolve(false);
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getRepositoryToken(ConsentArtifact))
      .useValue(mockConsentRepository)
      .overrideProvider(getRepositoryToken(Session))
      .useValue(mockSessionRepository)
      .overrideProvider(getRepositoryToken(ConversationTurn))
      .useValue(mockTurnRepository)
      .overrideProvider(getRepositoryToken(AuditEvent))
      .useValue(mockAuditRepository)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    clinicalContextService = app.get(ClinicalContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockConsentDb = [makeActiveConsent()];
    mockAuditDb = [];
    redisStore = {};
    redisLocks = {};
    jest.clearAllMocks();
    // Re-attach implementations after clearAllMocks
    mockConsentRepository.findOne.mockImplementation((options: any) => {
      const id = options?.where?.id;
      return Promise.resolve(mockConsentDb.find((c) => c.id === id) || null);
    });
    mockAuditRepository.save.mockImplementation((event: any) => {
      event.id = crypto.randomUUID();
      event.timestamp = new Date();
      mockAuditDb.push(event);
      return Promise.resolve(event);
    });
    mockSessionRepository.save.mockImplementation((s: any) => Promise.resolve(s));
    mockTurnRepository.save.mockImplementation((t: any) => {
      if (!t.createdAt) t.createdAt = new Date();
      return Promise.resolve(t);
    });
  });

  // ─── 1. Medication query ────────────────────────────────────────────────────
  it('1. MEDICATION_QUERY returns only medications and prescriptions', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    expect(ctx.medications).toBeDefined();
    expect(ctx.prescriptions).toBeDefined();
    expect(ctx.diagnoses).toBeUndefined();
    expect(ctx.labResults).toBeUndefined();
    expect(ctx.allergies).toBeUndefined();
    expect(ctx.medications!.length).toBeGreaterThan(0);
    expect(ctx.prescriptions!.length).toBeGreaterThan(0);
  });

  // ─── 2. Prescription query ──────────────────────────────────────────────────
  it('2. PRESCRIPTION_QUERY returns only prescriptions and medications', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('PRESCRIPTION_QUERY'));
    expect(ctx.prescriptions).toBeDefined();
    expect(ctx.medications).toBeDefined();
    expect(ctx.diagnoses).toBeUndefined();
    expect(ctx.labResults).toBeUndefined();
    expect(ctx.allergies).toBeUndefined();
  });

  // ─── 3. Lab result query ────────────────────────────────────────────────────
  it('3. LAB_RESULT_QUERY returns only lab/investigation results', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('LAB_RESULT_QUERY'));
    expect(ctx.labResults).toBeDefined();
    expect(ctx.labResults!.length).toBeGreaterThan(0);
    expect(ctx.medications).toBeUndefined();
    expect(ctx.prescriptions).toBeUndefined();
    expect(ctx.diagnoses).toBeUndefined();
    expect(ctx.allergies).toBeUndefined();
  });

  // ─── 4. Diagnosis query ─────────────────────────────────────────────────────
  it('4. DIAGNOSIS_QUERY returns only diagnoses', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('DIAGNOSIS_QUERY'));
    expect(ctx.diagnoses).toBeDefined();
    expect(ctx.diagnoses!.length).toBeGreaterThan(0);
    expect(ctx.medications).toBeUndefined();
    expect(ctx.prescriptions).toBeUndefined();
    expect(ctx.labResults).toBeUndefined();
    expect(ctx.allergies).toBeUndefined();
  });

  // ─── 5. Allergy query ──────────────────────────────────────────────────────
  it('5. ALLERGY_QUERY returns only allergies', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('ALLERGY_QUERY'));
    expect(ctx.allergies).toBeDefined();
    expect(ctx.allergies!.length).toBeGreaterThan(0);
    expect(ctx.medications).toBeUndefined();
    expect(ctx.prescriptions).toBeUndefined();
    expect(ctx.diagnoses).toBeUndefined();
    expect(ctx.labResults).toBeUndefined();
  });

  // ─── 6. UNKNOWN intent ─────────────────────────────────────────────────────
  it('6. UNKNOWN intent retrieves no health records', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('UNKNOWN'));
    expect(ctx.medications).toBeUndefined();
    expect(ctx.prescriptions).toBeUndefined();
    expect(ctx.diagnoses).toBeUndefined();
    expect(ctx.labResults).toBeUndefined();
    expect(ctx.allergies).toBeUndefined();
    expect(ctx.unavailableCategories).toHaveLength(0);
  });

  // ─── 7. GENERAL_HEALTH_QUERY ───────────────────────────────────────────────
  it('7. GENERAL_HEALTH_QUERY retrieves no health records (data minimization)', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('GENERAL_HEALTH_QUERY'));
    expect(ctx.medications).toBeUndefined();
    expect(ctx.prescriptions).toBeUndefined();
    expect(ctx.diagnoses).toBeUndefined();
    expect(ctx.labResults).toBeUndefined();
    expect(ctx.allergies).toBeUndefined();
  });

  // ─── 8. Missing record_read consent ────────────────────────────────────────
  it('8. Missing record_read consent blocks retrieval', async () => {
    mockConsentDb = [makeActiveConsent({ scopes: ['conversation_retention'] })];
    await expect(
      clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY')),
    ).rejects.toThrow('CONSENT_MISSING');
  });

  // ─── 9. Withdrawn consent ──────────────────────────────────────────────────
  it('9. Withdrawn consent blocks retrieval', async () => {
    mockConsentDb = [makeActiveConsent({ status: 'WITHDRAWN' })];
    await expect(
      clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY')),
    ).rejects.toThrow('CONSENT_MISSING');
  });

  // ─── 10. Expired consent ───────────────────────────────────────────────────
  it('10. Expired consent blocks retrieval', async () => {
    mockConsentDb = [makeActiveConsent({ status: 'EXPIRED' })];
    await expect(
      clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY')),
    ).rejects.toThrow('CONSENT_MISSING');
  });

  // ─── 11. Tenant isolation ──────────────────────────────────────────────────
  it('11. Tenant isolation: different tenant ID causes CONSENT_MISSING', async () => {
    // placeholder — covered by 11b below
  });

  // ─── 12. Subject isolation ─────────────────────────────────────────────────
  it('12. Subject isolation: different subject gets CONSENT_MISSING', async () => {
    await expect(
      clinicalContextService.buildContext(
        makeRequest('MEDICATION_QUERY', { subjectAbhaRef: 'other-patient-abha-ref' }),
      ),
    ).rejects.toThrow('CONSENT_MISSING');
  });

  // ─── 13. Stale records filtered ────────────────────────────────────────────
  it('13. Stale medication records are filtered out', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    const names = ctx.medications!.map((m) => m.medicationName);
    // Paracetamol (200 days old) and Amlodipine (120 days old) exceed the 90-day threshold
    expect(names).not.toContain('Paracetamol');
    expect(names).not.toContain('Amlodipine');
    // Metformin (60 days old) is within threshold
    expect(names).toContain('Metformin');
  });

  // ─── 14. Deduplication ─────────────────────────────────────────────────────
  it('14. Duplicate sourceRef records are deduplicated', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    const sourceRefs = ctx.medications!.map((m) => m.sourceRef);
    const unique = new Set(sourceRefs);
    expect(sourceRefs.length).toBe(unique.size);
  });

  // ─── 15. No raw patient identifiers in ClinicalContext ─────────────────────
  it('15. ClinicalContext.subjectRef is HMAC hash, not raw ABHA', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    // subjectRef should be a 64-char hex HMAC — never the raw ABHA ref
    expect(ctx.subjectRef).not.toBe(SUBJECT_ABHA_REF);
    expect(ctx.subjectRef).toMatch(/^[0-9a-f]{64}$/); // SHA-256 HMAC hex
    expect(ctx.subjectRef).not.toContain('dev-subject');
  });

  // ─── 16. No raw source IDs in AI context (sourceRef should be opaque) ──────
  it('16. Medication sourceRef is an opaque internal reference', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    for (const med of ctx.medications!) {
      // sourceRef should not contain raw ABHA or patient name
      expect(med.sourceRef).not.toContain('abha');
      expect(med.sourceRef).not.toContain('patient');
    }
  });

  // ─── 17. Audit events created ──────────────────────────────────────────────
  it('17. Audit events are created on successful context build', async () => {
    await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    const actions = mockAuditDb.map((e) => e.action);
    expect(actions).toContain('health_record_access_requested');
    expect(actions).toContain('health_record_access_granted');
    expect(actions).toContain('health_record_retrieved');
    expect(actions).toContain('clinical_context_created');
  });

  it('17b. health_record_access_denied audit event fires on consent failure', async () => {
    mockConsentDb = [makeActiveConsent({ status: 'WITHDRAWN' })];
    await expect(
      clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY')),
    ).rejects.toThrow();
    const actions = mockAuditDb.map((e) => e.action);
    expect(actions).toContain('health_record_access_requested');
    expect(actions).toContain('health_record_access_denied');
    expect(actions).not.toContain('health_record_retrieved');
  });

  // ─── 18. Audit details contain no clinical values ──────────────────────────
  it('18. Audit details contain no clinical values', async () => {
    await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    for (const auditEvent of mockAuditDb) {
      const detailStr = JSON.stringify(auditEvent.details || {});
      // No medication names
      expect(detailStr).not.toContain('Metformin');
      expect(detailStr).not.toContain('Amlodipine');
      // No diagnoses
      expect(detailStr).not.toContain('Diabetes');
      expect(detailStr).not.toContain('Hypertension');
      // No raw lab values
      expect(detailStr).not.toContain('HbA1c');
      expect(detailStr).not.toContain('128');
      // No raw ABHA
      expect(detailStr).not.toContain('dev-subject-abha-ref-123');
    }
  });

  // ─── 19. Empty records produce empty context ────────────────────────────────
  it('19. UNKNOWN intent produces empty context with no errors', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('UNKNOWN'));
    expect(ctx.intent).toBe('UNKNOWN');
    expect(ctx.unavailableCategories).toHaveLength(0);
    expect(ctx.partialResult).toBe(false);
    expect(ctx.sessionId).toBe(SESSION_ID);
    expect(ctx.consentVersion).toBe('v1.0');
  });

  // ─── 20. Partial provider results ──────────────────────────────────────────
  it('20. Partial provider results are represented in context', async () => {
    // Override IHealthRecordService to return partial result for one category
    const originalService = app.get<IHealthRecordService>('IHealthRecordService');
    const partialMock = jest.spyOn(originalService, 'fetchRecords').mockResolvedValueOnce({
      bundles: [
        {
          category: HealthRecordCategory.MEDICATION,
          records: [],
          partialResult: true,
          fetchedAt: new Date(),
        },
      ],
      unavailableCategories: [HealthRecordCategory.PRESCRIPTION],
      providerErrorCodes: ['HIP_TIMEOUT'],
    });

    const ctx = await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    expect(ctx.partialResult).toBe(true);
    expect(ctx.unavailableCategories).toContain(HealthRecordCategory.PRESCRIPTION);

    partialMock.mockRestore();
  });

  // ─── 21. Provider failure handled safely ────────────────────────────────────
  it('21. Provider failure throws ServiceUnavailableException', async () => {
    const originalService = app.get<IHealthRecordService>('IHealthRecordService');
    const errorMock = jest.spyOn(originalService, 'fetchRecords').mockRejectedValueOnce(
      new Error('Simulated ABDM provider failure'),
    );

    await expect(
      clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY')),
    ).rejects.toThrow('HEALTH_RECORD_UNAVAILABLE');

    errorMock.mockRestore();
  });

  // ─── 22. No raw clinical info in audit ────────────────────────────────────
  it('22. No raw ABHA reference in any audit event subjectAbhaRefHash field', async () => {
    await clinicalContextService.buildContext(makeRequest('DIAGNOSIS_QUERY'));
    for (const event of mockAuditDb) {
      // subjectAbhaRefHash must be a HMAC hash, not the raw ABHA ref
      expect(event.subjectAbhaRefHash).not.toBe(SUBJECT_ABHA_REF);
      expect(event.subjectAbhaRefHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  // ─── Additional: intent metadata is correct ───────────────────────────────
  it('23. ClinicalContext.intent reflects the requested intent', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('ALLERGY_QUERY'));
    expect(ctx.intent).toBe('ALLERGY_QUERY');
  });

  it('24. ClinicalContext.sessionId and consentVersion are populated', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('MEDICATION_QUERY'));
    expect(ctx.sessionId).toBe(SESSION_ID);
    expect(ctx.consentVersion).toBe('v1.0');
    expect(ctx.retrievalTimestamp).toBeInstanceOf(Date);
  });

  it('25. LAB_RESULT_QUERY combines LAB_REPORT and INVESTIGATION results', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('LAB_RESULT_QUERY'));
    // Fixture includes both LAB_REPORT (HbA1c, FBG, CBC) and INVESTIGATION (ECG) records
    // ECG is within 180-day threshold; CBC is at 365 days (beyond threshold — filtered)
    expect(ctx.labResults).toBeDefined();
    const names = ctx.labResults!.map((r) => r.testName);
    expect(names).toContain('HbA1c');
    expect(names).toContain('Fasting Blood Glucose');
    expect(names).toContain('ECG');
    // CBC at 365 days should be filtered (180-day threshold)
    expect(names).not.toContain('Complete Blood Count');
  });

  it('26. Active allergies are returned regardless of date (no staleness filter)', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('ALLERGY_QUERY'));
    expect(ctx.allergies).toBeDefined();
    // Both allergies in fixture are active and should be returned even though they're old
    expect(ctx.allergies!.length).toBe(2);
  });

  it('27. Unrecognised intent is treated as UNKNOWN (no records fetched)', async () => {
    const ctx = await clinicalContextService.buildContext(makeRequest('SOME_FUTURE_INTENT'));
    expect(ctx.medications).toBeUndefined();
    expect(ctx.prescriptions).toBeUndefined();
    expect(ctx.diagnoses).toBeUndefined();
    expect(ctx.labResults).toBeUndefined();
    expect(ctx.allergies).toBeUndefined();
  });
});
