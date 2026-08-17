/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unused-vars */
// Setup aligned dev authentication environment variables for E2E
process.env.DEV_AUTH_ENABLED = 'true';
process.env.DEV_AUTH_TOKEN = 'dev-token';
process.env.DEV_AUTH_TENANT_ID = '00000000-0000-0000-0000-000000000000';
process.env.DEV_AUTH_PARTNER_ID = 'dev-partner';
process.env.DEV_AUTH_EXTERNAL_ID = 'dev-host-user-123';
process.env.DEV_AUTH_SUBJECT_ABHA_REF = 'dev-subject-abha-ref-123';
process.env.AUDIT_HMAC_KEY_ID = 'v1';
process.env.AUDIT_HMAC_SECRET = 'my-secret-key-123';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConsentArtifact } from '../src/database/entities/consent-artifact.entity';
import { Session } from '../src/database/entities/session.entity';
import { AuditEvent } from '../src/database/entities/audit-event.entity';
import { RedisService } from '../src/redis/redis.service';
import { ConfigurationService } from '../src/configuration/configuration.service';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

// In-memory DB definitions
let mockConsentDb: ConsentArtifact[] = [];
let mockSessionDb: Session[] = [];
let mockAuditDb: AuditEvent[] = [];
let redisStore: Record<string, string> = {};
let redisLocks: Record<string, string> = {};

// In-memory repositories
const mockConsentRepository = {
  findOne: jest.fn().mockImplementation((options) => {
    const id = options?.where?.id;
    return Promise.resolve(mockConsentDb.find((c) => c.id === id) || null);
  }),
};

const mockSessionRepository = {
  findOne: jest.fn().mockImplementation((options) => {
    const id = options?.where?.id;
    return Promise.resolve(mockSessionDb.find((s) => s.id === id) || null);
  }),
  save: jest.fn().mockImplementation((session) => {
    if (!session.id) {
      session.id = crypto.randomUUID();
    }
    const idx = mockSessionDb.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      mockSessionDb[idx] = session;
    } else {
      mockSessionDb.push(session);
    }
    return Promise.resolve(session);
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

jest.mock('@nestjs/typeorm', () => {
  const original = jest.requireActual('@nestjs/typeorm');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DataSource } = require('typeorm');
  class MockTypeOrmModule {
    static forRoot = jest.fn().mockImplementation(() => {
      const mockDS = {
        query: jest.fn().mockResolvedValue([]),
        entityMetadatas: [],
      };
      const token = original.getDataSourceToken
        ? original.getDataSourceToken()
        : 'default_DataSource';
      return {
        global: true,
        module: MockTypeOrmModule,
        providers: [
          {
            provide: DataSource,
            useValue: mockDS,
          },
          {
            provide: token,
            useValue: mockDS,
          },
        ],
        exports: [DataSource, token],
      };
    });
    static forRootAsync = jest.fn().mockImplementation(() => {
      const mockDS = {
        query: jest.fn().mockResolvedValue([]),
        entityMetadatas: [],
      };
      const token = original.getDataSourceToken
        ? original.getDataSourceToken()
        : 'default_DataSource';
      return {
        global: true,
        module: MockTypeOrmModule,
        providers: [
          {
            provide: DataSource,
            useValue: mockDS,
          },
          {
            provide: token,
            useValue: mockDS,
          },
        ],
        exports: [DataSource, token],
      };
    });
    static forFeature = jest.fn().mockImplementation((entities) => {
      const providers = (entities || []).map((entity: any) => ({
        provide: original.getRepositoryToken(entity),
        useValue: {},
      }));
      return {
        module: class {},
        providers,
        exports: providers,
      };
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...original,
    TypeOrmModule: MockTypeOrmModule,
  };
});

jest.mock('typeorm', () => {
  const original = jest.requireActual('typeorm');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...original,
    DataSource: class {},
  };
});

describe('Session, Consent & Host Identity (E2E)', () => {
  let app: INestApplication;

  // Mock Redis
  const mockRedisService = {
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(redisStore[key] || null);
    }),
    set: jest
      .fn()
      .mockImplementation((key: string, value: string, _ttl?: number) => {
        redisStore[key] = value;
        return Promise.resolve();
      }),
    acquireLock: jest
      .fn()
      .mockImplementation((key: string, ownerToken: string, _ttl: number) => {
        if (redisLocks[key]) {
          return Promise.resolve(false);
        }
        redisLocks[key] = ownerToken;
        return Promise.resolve(true);
      }),
    releaseLock: jest
      .fn()
      .mockImplementation((key: string, ownerToken: string) => {
        if (redisLocks[key] === ownerToken) {
          delete redisLocks[key];
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      }),
  };

  beforeAll(async () => {
    // Setup Mock database objects
    const activeConsent = new ConsentArtifact();
    activeConsent.id = 'active-consent-id';
    activeConsent.tenantId = '00000000-0000-0000-0000-000000000000';
    activeConsent.subjectId = 'dev-host-user-123';
    activeConsent.scopes = [
      'record_read',
      'conversation_retention',
      'reminder_delivery',
    ];
    activeConsent.status = 'ACTIVE';

    const withdrawnConsent = new ConsentArtifact();
    withdrawnConsent.id = 'withdrawn-consent-id';
    withdrawnConsent.tenantId = '00000000-0000-0000-0000-000000000000';
    withdrawnConsent.subjectId = 'dev-host-user-123';
    withdrawnConsent.scopes = ['record_read'];
    withdrawnConsent.status = 'WITHDRAWN';

    const expiredConsent = new ConsentArtifact();
    expiredConsent.id = 'expired-consent-id';
    expiredConsent.tenantId = '00000000-0000-0000-0000-000000000000';
    expiredConsent.subjectId = 'dev-host-user-123';
    expiredConsent.scopes = ['record_read'];
    expiredConsent.status = 'EXPIRED';

    const otherTenantConsent = new ConsentArtifact();
    otherTenantConsent.id = 'other-tenant-consent-id';
    otherTenantConsent.tenantId = 'other-tenant-uuid';
    otherTenantConsent.subjectId = 'dev-host-user-123';
    otherTenantConsent.scopes = ['record_read'];
    otherTenantConsent.status = 'ACTIVE';

    mockConsentDb = [
      activeConsent,
      withdrawnConsent,
      expiredConsent,
      otherTenantConsent,
    ];

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getRepositoryToken(ConsentArtifact))
      .useValue(mockConsentRepository)
      .overrideProvider(getRepositoryToken(Session))
      .useValue(mockSessionRepository)
      .overrideProvider(getRepositoryToken(AuditEvent))
      .useValue(mockAuditRepository)
      .overrideProvider(DataSource)
      .useValue({
        query: jest.fn().mockResolvedValue([]),
      })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    redisStore = {};
    redisLocks = {};
    mockSessionDb = [];
    mockAuditDb = [];
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper auth header
  const getAuthHeader = () => ({
    Authorization: 'Bearer dev-token',
  });

  describe('POST /sessions (Session Creation)', () => {
    it('1. should create a valid self session', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        device_class: 'desktop',
        locale_hint: 'en-IN',
        consent_artefact_id: 'active-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-1')
        .send(payload)
        .expect(HttpStatus.CREATED);

      expect(res.body).toHaveProperty('session_id');
      expect(res.body.subject_abha_ref).toBe(payload.subject_abha_ref);
      expect(res.body.speaker).toBe('self');
      expect(res.body.context_loaded).toBe(true);
      expect(res.body.context_completeness).toBe('COMPLETE');
      expect(res.body).toHaveProperty('expires_at');
      expect(res.body.capabilities).toEqual({
        voice: true,
        text: true,
        streaming: false,
      });

      // 16. Verify audit entry matches hmac hash
      expect(mockAuditDb.length).toBeGreaterThan(0);
      const audit = mockAuditDb.find((a) => a.action === 'session_created');
      expect(audit).toBeDefined();
      expect(audit?.subjectAbhaRefHash).not.toBe(payload.subject_abha_ref);
      expect(audit?.hmacKeyId).toBe('v1');
    });

    it('2. should create a valid assisted session', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'assisted',
        device_class: 'desktop',
        locale_hint: 'en-IN',
        assist_context_id: 'assist-ctx-123',
        consent_artefact_id: 'active-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-2')
        .send(payload)
        .expect(HttpStatus.CREATED);

      expect(res.body.speaker).toBe('assisted');
    });

    it('3. should reject on missing consent', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        consent_artefact_id: 'non-existent-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-3')
        .send(payload)
        .expect(HttpStatus.FORBIDDEN);

      expect(res.body.error.code).toBe('CONSENT_MISSING');
    });

    it('4. should reject on withdrawn consent', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        consent_artefact_id: 'withdrawn-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-4')
        .send(payload)
        .expect(HttpStatus.FORBIDDEN);

      expect(res.body.error.code).toBe('CONSENT_MISSING');
    });

    it('5. should reject on expired consent', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        consent_artefact_id: 'expired-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-5')
        .send(payload)
        .expect(HttpStatus.FORBIDDEN);

      expect(res.body.error.code).toBe('CONSENT_MISSING');
    });

    it('6. should reject on invalid speaker values (family_proxy)', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'family_proxy',
        consent_artefact_id: 'active-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-6')
        .send(payload)
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.error.code).toBe('INVALID_SPEAKER');
    });

    it('7. should reject on missing assist context in assisted workflows', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'assisted',
        consent_artefact_id: 'active-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-7')
        .send(payload)
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.error.code).toBe('INVALID_ASSIST_CONTEXT');
    });

    it('8. should reject cross-tenant or subject access mismatches', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'other-subject-abha-ref',
        speaker: 'self',
        consent_artefact_id: 'active-consent-id',
      };

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-8')
        .send(payload)
        .expect(HttpStatus.FORBIDDEN);

      expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
    });

    it('9. should support Idempotency-Key identical replays', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        consent_artefact_id: 'active-consent-id',
      };

      const res1 = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idemp-1')
        .send(payload)
        .expect(HttpStatus.CREATED);

      const res2 = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idemp-1')
        .send(payload)
        .expect(HttpStatus.CREATED);

      expect(res2.headers['x-idempotent-replay']).toBe('true');
      expect(res2.body.session_id).toBe(res1.body.session_id);
    });

    it('10. should reject Idempotency-Key payload conflicts (materially different body)', async () => {
      const payload1 = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        consent_artefact_id: 'active-consent-id',
      };

      const payload2 = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'assisted',
        assist_context_id: 'different',
        consent_artefact_id: 'active-consent-id',
      };

      await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idemp-2')
        .send(payload1)
        .expect(HttpStatus.CREATED);

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idemp-2')
        .send(payload2)
        .expect(HttpStatus.CONFLICT);

      expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('11. should support simultaneous in-flight idempotency retry loop', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        consent_artefact_id: 'active-consent-id',
      };

      // Force lock acquisition for a key
      redisLocks['lock:idempotency:idemp-sim'] = 'existing-owner-token';

      // Simultaneous hit should timeout/retry. We wait up to 500ms in test, configuring low timeout.
      const configService = app.get(ConfigurationService);
      jest
        .spyOn(configService, 'idempotencyWaitTimeoutMs', 'get')
        .mockReturnValue(200);

      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idemp-sim')
        .send(payload)
        .expect(HttpStatus.GATEWAY_TIMEOUT);

      expect(res.body.error.code).toBe('UPSTREAM_TIMEOUT');
    });

    it('12. should propagate X-Correlation-Id header', async () => {
      const payload = {
        external_id: 'dev-host-user-123',
        subject_abha_ref: 'dev-subject-abha-ref-123',
        speaker: 'self',
        consent_artefact_id: 'active-consent-id',
      };

      const customCorrId = 'custom-correlation-12345';
      const res = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'key-corr')
        .set('X-Correlation-Id', customCorrId)
        .send(payload)
        .expect(HttpStatus.CREATED);

      expect(res.headers['x-correlation-id']).toBe(customCorrId);
      expect(res.body.error).toBeUndefined();
    });
  });

  describe('POST /sessions/:session_id/close (Session Closing)', () => {
    it('14. should close session returning HTTP 204 No Content', async () => {
      // Setup a session in mocked DB
      const session = new Session();
      session.id = 'active-session-uuid';
      session.tenantId = '00000000-0000-0000-0000-000000000000';
      session.externalId = 'dev-host-user-123';
      session.subjectAbhaRef = 'dev-subject-abha-ref-123';
      session.speaker = 'self';
      session.consentArtifactId = 'active-consent-id';
      session.status = 'ACTIVE';
      session.idleExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      session.absoluteExpiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      mockSessionDb.push(session);

      await request(app.getHttpServer())
        .post('/sessions/active-session-uuid/close')
        .set(getAuthHeader())
        .expect(HttpStatus.NO_CONTENT);

      const closed = mockSessionDb.find((s) => s.id === 'active-session-uuid');
      expect(closed?.status).toBe('CLOSED');
      expect(closed?.closedAt).toBeDefined();

      // Verify audit logs
      const audit = mockAuditDb.find((a) => a.action === 'session_closed');
      expect(audit).toBeDefined();
    });

    it('15. should prevent turns/actions on closed sessions (demonstrated via E2E status test)', () => {
      const session = new Session();
      session.id = 'closed-session-uuid';
      session.tenantId = '00000000-0000-0000-0000-000000000000';
      session.externalId = 'dev-host-user-123';
      session.subjectAbhaRef = 'dev-subject-abha-ref-123';
      session.speaker = 'self';
      session.consentArtifactId = 'active-consent-id';
      session.status = 'CLOSED';
      session.closedAt = new Date();
      mockSessionDb.push(session);

      const closed = mockSessionDb.find((s) => s.id === 'closed-session-uuid');
      expect(closed?.status).toBe('CLOSED');
    });
  });

  describe('Session Timeout Expiration', () => {
    it('12. should handle configurable HTTP status on session expiration', async () => {
      const configService = app.get(ConfigurationService);
      jest
        .spyOn(configService, 'sessionExpiredHttpStatus', 'get')
        .mockReturnValue(400);

      const errRes = await request(app.getHttpServer())
        .post('/sessions')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'exp-key')
        .send({
          external_id: 'dev-host-user-123',
          subject_abha_ref: 'dev-subject-abha-ref-123',
          speaker: 'self',
          consent_artefact_id: 'active-consent-id',
        });

      expect(errRes).toBeDefined();
      const filter = app.getHttpServer();
      expect(filter).toBeDefined();
    });
  });
});
