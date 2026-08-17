/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { ConsentArtifact } from '../src/database/entities/consent-artifact.entity';
import { Session } from '../src/database/entities/session.entity';
import { ConversationTurn } from '../src/database/entities/conversation-turn.entity';
import { AuditEvent } from '../src/database/entities/audit-event.entity';
import { RedisService } from '../src/redis/redis.service';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';

// Setup aligned dev authentication environment variables for E2E
process.env.DEV_AUTH_ENABLED = 'true';
process.env.DEV_AUTH_TOKEN = 'dev-token';
process.env.DEV_AUTH_TENANT_ID = '00000000-0000-0000-0000-000000000000';
process.env.DEV_AUTH_PARTNER_ID = 'dev-partner';
process.env.DEV_AUTH_EXTERNAL_ID = 'dev-host-user-123';
process.env.DEV_AUTH_SUBJECT_ABHA_REF = 'dev-subject-abha-ref-123';
process.env.AUDIT_HMAC_KEY_ID = 'v1';
process.env.AUDIT_HMAC_SECRET = 'my-secret-key-123';

// In-memory E2E database definitions
let mockConsentDb: ConsentArtifact[] = [];
let mockSessionDb: Session[] = [];
let mockTurnDb: ConversationTurn[] = [];
let mockAuditDb: AuditEvent[] = [];
let redisStore: Record<string, string> = {};
let redisLocks: Record<string, string> = {};

// In-memory repositories for injection resolution
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

const mockTurnRepository = {
  findOne: jest.fn().mockImplementation((options) => {
    const id = options?.where?.id;
    return Promise.resolve(mockTurnDb.find((t) => t.id === id) || null);
  }),
  save: jest.fn().mockImplementation((turn) => {
    if (!turn.id) {
      turn.id = crypto.randomUUID();
    }
    const idx = mockTurnDb.findIndex((t) => t.id === turn.id);
    if (idx >= 0) {
      mockTurnDb[idx] = turn;
    } else {
      mockTurnDb.push(turn);
    }
    return Promise.resolve(turn);
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

// Jest mocks for NestJS TypeORM integration to avoid database connection
jest.mock('@nestjs/typeorm', () => {
  const original = jest.requireActual('@nestjs/typeorm');
   
  const { DataSource } = require('typeorm');
  class MockTypeOrmModule {
    static forRoot = jest.fn().mockImplementation(() => {
      const mockDS = {
        query: jest.fn().mockResolvedValue([]),
        entityMetadatas: [],
      };
      const token = original.getDataSourceToken ? original.getDataSourceToken() : 'default_DataSource';
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
      const token = original.getDataSourceToken ? original.getDataSourceToken() : 'default_DataSource';
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
   
  return {
    ...original,
    TypeOrmModule: MockTypeOrmModule,
  };
});

jest.mock('typeorm', () => {
  const original = jest.requireActual('typeorm');
   
  return {
    ...original,
    DataSource: class {},
  };
});

describe('Conversation Turn Lifecycle (E2E)', () => {
  let app: INestApplication;

  // Mock Redis Service
  const mockRedisService = {
    get: jest.fn().mockImplementation((key: string) => {
      return Promise.resolve(redisStore[key] || null);
    }),
    set: jest.fn().mockImplementation((key: string, val: string) => {
      redisStore[key] = val;
      return Promise.resolve('OK');
    }),
    acquireLock: jest
      .fn()
      .mockImplementation((key: string, owner: string) => {
        if (redisLocks[key]) {
          return Promise.resolve(false);
        }
        redisLocks[key] = owner;
        return Promise.resolve(true);
      }),
    releaseLock: jest.fn().mockImplementation((key: string, owner: string) => {
      if (redisLocks[key] === owner) {
        delete redisLocks[key];
        return Promise.resolve(true);
      }
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
      .overrideProvider(getDataSourceToken())
      .useValue({
        query: jest.fn().mockResolvedValue([]),
        transaction: jest.fn().mockImplementation(async (runInTransaction) => {
          // Implement transaction logic with E2E UNIQUE checks & rollbacks
          const mockEntityManager = {
            findOne: jest.fn().mockImplementation((entityClass, options) => {
              const className = entityClass.name;
              if (className === 'Session') {
                const id = options?.where?.id;
                return Promise.resolve(
                  mockSessionDb.find((s) => s.id === id) || null,
                );
              }
              if (className === 'ConsentArtifact') {
                const id = options?.where?.id;
                return Promise.resolve(
                  mockConsentDb.find((c) => c.id === id) || null,
                );
              }
              if (className === 'ConversationTurn') {
                if (options?.order?.turnNumber === 'DESC') {
                  const sessionId = options?.where?.sessionId;
                  const sessionTurns = mockTurnDb.filter(
                    (t) => t.sessionId === sessionId,
                  );
                  if (sessionTurns.length === 0) return Promise.resolve(null);
                  sessionTurns.sort((a, b) => b.turnNumber - a.turnNumber);
                  return Promise.resolve(sessionTurns[0]);
                }
                if (options?.where?.idempotencyKey) {
                  const { sessionId, idempotencyKey } = options.where;
                  return Promise.resolve(
                    mockTurnDb.find(
                      (t) =>
                        t.sessionId === sessionId &&
                        t.idempotencyKey === idempotencyKey,
                    ) || null,
                  );
                }
                const id = options?.where?.id;
                return Promise.resolve(
                  mockTurnDb.find((t) => t.id === id) || null,
                );
              }
              return Promise.resolve(null);
            }),
            save: jest.fn().mockImplementation((entity) => {
              const className = entity.constructor.name;
              if (className === 'Session') {
                const idx = mockSessionDb.findIndex((s) => s.id === entity.id);
                if (idx >= 0) {
                  mockSessionDb[idx] = entity;
                } else {
                  mockSessionDb.push(entity);
                }
                return Promise.resolve(entity);
              }
              if (className === 'ConversationTurn') {
                if (!entity.id) {
                  entity.id = crypto.randomUUID();
                }
                if (!entity.createdAt) {
                  entity.createdAt = new Date();
                }
                const idx = mockTurnDb.findIndex((t) => t.id === entity.id);
                if (idx >= 0) {
                  mockTurnDb[idx] = entity;
                } else {
                  // DB-level Unique Constraint checks
                  const dupTurnNumber = mockTurnDb.find(
                    (t) =>
                      t.sessionId === entity.sessionId &&
                      t.turnNumber === entity.turnNumber &&
                      t.id !== entity.id,
                  );
                  if (dupTurnNumber) {
                    throw new Error(
                      'uq_session_turn unique constraint violation',
                    );
                  }
                  if (entity.idempotencyKey) {
                    const dupIdempotency = mockTurnDb.find(
                      (t) =>
                        t.sessionId === entity.sessionId &&
                        t.idempotencyKey === entity.idempotencyKey &&
                        t.id !== entity.id,
                    );
                    if (dupIdempotency) {
                      throw new Error(
                        'uq_session_idempotency unique constraint violation',
                      );
                    }
                  }
                  mockTurnDb.push(entity);
                }
                return Promise.resolve(entity);
              }
              return Promise.resolve(entity);
            }),
          };

          return runInTransaction(mockEntityManager);
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockConsentDb = [];
    mockSessionDb = [];
    mockTurnDb = [];
    mockAuditDb = [];
    redisStore = {};
    redisLocks = {};
    jest.clearAllMocks();
  });

  const getAuthHeader = () => ({
    Authorization: 'Bearer dev-token',
  });

  const setupValidSession = (
    consentScopes = ['record_read', 'conversation_retention'],
  ) => {
    // 1. Setup consent
    const consent = new ConsentArtifact();
    consent.id = 'active-consent-id';
    consent.tenantId = '00000000-0000-0000-0000-000000000000';
    consent.subjectId = 'dev-host-user-123';
    consent.consentVersion = 'v1';
    consent.scopes = consentScopes;
    consent.language = 'en';
    consent.deliveryMode = 'in-app';
    consent.retentionInfo = { retention: 'forever' };
    consent.status = 'ACTIVE';
    mockConsentDb.push(consent);

    // 2. Setup session
    const session = new Session();
    session.id = 'active-session-uuid';
    session.tenantId = '00000000-0000-0000-0000-000000000000';
    session.externalId = 'dev-host-user-123';
    session.subjectAbhaRef = 'dev-subject-abha-ref-123';
    session.speaker = 'self';
    session.consentArtifactId = consent.id;
    session.status = 'ACTIVE';
    session.idleExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    session.absoluteExpiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
    mockSessionDb.push(session);

    return { consent, session };
  };

  describe('POST /sessions/:session_id/turns', () => {
    it('1. should process a valid text turn, extend idle expiry, and emit audits', async () => {
      const { session } = setupValidSession();
      const initialIdle = new Date(session.idleExpiresAt.getTime());

      const res = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-1')
        .send({
          input_text: 'hello help',
          speaker: 'self',
          subject_ref: 'dev-subject-abha-ref-123',
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.turn_number).toBe(1);
      expect(res.body.response_type).toBe('text');
      expect(res.body.content.en).toBe(
        'Conversation processing is available in the prototype.',
      );

      // Check timeout extension
      const updatedSession = mockSessionDb.find((s) => s.id === session.id);
      expect(updatedSession?.idleExpiresAt.getTime()).toBeGreaterThan(
        initialIdle.getTime(),
      );

      // Check Turn DB persistence
      expect(mockTurnDb.length).toBe(1);
      expect(mockTurnDb[0].status).toBe('COMPLETED');
      expect(mockTurnDb[0].inputText).toBe('hello help');
      expect(mockTurnDb[0].conversationRetentionGranted).toBe(true);

      // Verify audits
      const turnReceived = mockAuditDb.find(
        (a) => a.action === 'turn_received',
      );
      const turnProcessed = mockAuditDb.find(
        (a) => a.action === 'turn_processed',
      );
      expect(turnReceived).toBeDefined();
      expect(turnProcessed).toBeDefined();
    });

    it('2. should return 404 for unknown sessions', async () => {
      await request(app.getHttpServer())
        .post('/sessions/non-existent-uuid/turns')
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-2')
        .send({ input_text: 'hello' })
        .expect(HttpStatus.NOT_FOUND);
    });

    it('3. should enforce tenant boundary ownership', async () => {
      const { session } = setupValidSession();
      session.tenantId = 'cross-tenant-uuid';

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-3')
        .send({ input_text: 'hello' })
        .expect(HttpStatus.FORBIDDEN);
    });

    it('4. should prevent turn processing on closed sessions', async () => {
      const { session } = setupValidSession();
      session.status = 'CLOSED';

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-4')
        .send({ input_text: 'hello' })
        .expect(HttpStatus.FORBIDDEN);
    });

    it('5. should reject turns on expired sessions', async () => {
      const { session } = setupValidSession();
      session.idleExpiresAt = new Date(Date.now() - 1000); // Expired 1s ago

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-5')
        .send({ input_text: 'hello' })
        .expect(HttpStatus.GONE);
    });

    it('6. should reject turns if consent is missing or withdrawn', async () => {
      const { consent, session } = setupValidSession();
      consent.status = 'WITHDRAWN'; // Withdrawn consent

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-6')
        .send({ input_text: 'hello' })
        .expect(HttpStatus.FORBIDDEN);
    });

    it('7. should validate speaker consistency', async () => {
      const { session } = setupValidSession();

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-7')
        .send({
          input_text: 'hello',
          speaker: 'assisted', // Mismatch, session is self
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('8. should validate subject consistency', async () => {
      const { session } = setupValidSession();

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-8')
        .send({
          input_text: 'hello',
          subject_ref: 'wrong-subject-ref', // Mismatch
        })
        .expect(HttpStatus.FORBIDDEN);
    });

    it('9. should redact input and output texts when conversation_retention scope is not granted', async () => {
      const { session } = setupValidSession(['record_read']); // Missing conversation_retention

      const res = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-9')
        .send({ input_text: 'my raw health data' })
        .expect(HttpStatus.CREATED);

      expect(res.body.content.en).toBe(
        'Conversation processing is available in the prototype.',
      );

      // Check DB turn record
      expect(mockTurnDb.length).toBe(1);
      expect(mockTurnDb[0].inputText).toBeNull();
      expect(mockTurnDb[0].outputText).toBeNull();
      expect(mockTurnDb[0].conversationRetentionGranted).toBe(false);
    });

    it('10. should increment turn numbers sequentially', async () => {
      const { session } = setupValidSession();

      const res1 = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-10-1')
        .send({ input_text: 'turn 1' })
        .expect(HttpStatus.CREATED);

      const res2 = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'turn-key-10-2')
        .send({ input_text: 'turn 2' })
        .expect(HttpStatus.CREATED);

      expect(res1.body.turn_number).toBe(1);
      expect(res2.body.turn_number).toBe(2);
    });

    it('11. should handle idempotency replays safely', async () => {
      const { session } = setupValidSession();

      const res1 = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idem-key')
        .send({ input_text: 'idem turn' })
        .expect(HttpStatus.CREATED);

      // Replay same key & body (handled by Redis interceptor mock)
      // We populate redisStore to simulate completed cache hit
      const cacheKey = `idempotency:session:idem-key`;
      mockRedisService.set(
        cacheKey,
        JSON.stringify({
          requestHash: crypto
            .createHash('sha256')
            .update(JSON.stringify({ input_text: 'idem turn' }))
            .digest('hex'),
          responseStatus: 201,
          responseBody: res1.body,
        }),
      );

      const res2 = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idem-key')
        .send({ input_text: 'idem turn' })
        .expect(HttpStatus.CREATED);

      expect(res2.headers['x-idempotent-replay']).toBe('true');
      expect(res2.body.turn_number).toBe(1);
    });

    it('12. should reject idempotency key replays with conflicting bodies', async () => {
      const { session } = setupValidSession();

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idem-key-conflict')
        .send({ input_text: 'idem body 1' })
        .expect(HttpStatus.CREATED);

      // Populate Redis cache for collision checking
      const cacheKey = `idempotency:session:idem-key-conflict`;
      mockRedisService.set(
        cacheKey,
        JSON.stringify({
          requestHash: crypto
            .createHash('sha256')
            .update(JSON.stringify({ input_text: 'idem body 1' }))
            .digest('hex'),
          responseStatus: 201,
          responseBody: { turn_number: 1 },
        }),
      );

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'idem-key-conflict')
        .send({ input_text: 'different body content' }) // Conflict
        .expect(HttpStatus.CONFLICT);
    });

    it('13. should handle Transaction 1 failure and rollback updates', async () => {
      const { session } = setupValidSession();
      const originalIdle = new Date(session.idleExpiresAt.getTime());

      // Send a request trigger that crashes inside Transaction 1
      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'tx-fail-key')
        .send({ input_text: 'trigger-tx1-failure' })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR);

      // Assert turn was NOT created and session idle was NOT extended
      expect(mockTurnDb.length).toBe(0);
      const unchangedSession = mockSessionDb.find((s) => s.id === session.id);
      expect(unchangedSession?.idleExpiresAt.getTime()).toBe(
        originalIdle.getTime(),
      );
    });

    it('14. should handle processor failure, rollback turn to REJECTED, and allow retry recovery', async () => {
      const { session } = setupValidSession();

      // Override the processor temporarily to throw an error
      const processor = app.get<any>('IConversationProcessor');
      jest
        .spyOn(processor, 'processTurn')
        .mockRejectedValueOnce(new Error('LLM verification failed'));

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'retry-fail-key')
        .send({ input_text: 'process me' })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR);

      // Verify turn exists but status is REJECTED
      expect(mockTurnDb.length).toBe(1);
      expect(mockTurnDb[0].status).toBe('REJECTED');
      expect(mockTurnDb[0].selectedAgent).toContain('LLM verification failed');

      // Verify lock is released and we can successfully retry with the same key
      const res = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'retry-fail-key')
        .send({ input_text: 'process me' })
        .expect(HttpStatus.CREATED);

      expect(res.body.turn_number).toBe(1); // Same turn recycled, not duplicated
      expect(mockTurnDb.length).toBe(1); // Still exactly 1 turn row
      expect(mockTurnDb[0].status).toBe('COMPLETED');
    });

    it('15. should prevent duplicate turns in database via uq_session_idempotency constraint', async () => {
      const { session } = setupValidSession();

      const turn = new ConversationTurn();
      turn.sessionId = session.id;
      turn.turnNumber = 1;
      turn.correlationId = 'corr-1';
      turn.speaker = 'self';
      turn.subjectRef = 'abha-1';
      turn.idempotencyKey = 'shared-idem-key';
      turn.status = 'COMPLETED';
      mockTurnDb.push(turn);

      // Try creating another turn with the same session and idempotency key
      const turn2 = new ConversationTurn();
      turn2.sessionId = session.id;
      turn2.turnNumber = 2;
      turn2.correlationId = 'corr-2';
      turn2.speaker = 'self';
      turn2.subjectRef = 'abha-1';
      turn2.idempotencyKey = 'shared-idem-key';
      turn2.status = 'PROCESSING';

      const dataSource = app.get(DataSource);
      await expect(
        dataSource.transaction(async (manager) => {
          await manager.save(turn2);
        }),
      ).rejects.toThrow('uq_session_idempotency unique constraint violation');
    });

    it('16. should prevent duplicate turn numbers via uq_session_turn constraint', async () => {
      const { session } = setupValidSession();

      const turn = new ConversationTurn();
      turn.sessionId = session.id;
      turn.turnNumber = 5;
      turn.correlationId = 'corr-1';
      turn.speaker = 'self';
      turn.subjectRef = 'abha-1';
      turn.status = 'COMPLETED';
      mockTurnDb.push(turn);

      // Try saving another turn with the same turnNumber
      const turn2 = new ConversationTurn();
      turn2.sessionId = session.id;
      turn2.turnNumber = 5;
      turn2.correlationId = 'corr-2';
      turn2.speaker = 'self';
      turn2.subjectRef = 'abha-1';
      turn2.status = 'PROCESSING';

      const dataSource = app.get(DataSource);
      await expect(
        dataSource.transaction(async (manager) => {
          await manager.save(turn2);
        }),
      ).rejects.toThrow('uq_session_turn unique constraint violation');
    });

    it('17. should propagate correlation headers downstream', async () => {
      const { session } = setupValidSession();
      const correlationId = 'test-trace-id-999';

      const res = await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('X-Correlation-Id', correlationId)
        .set('Idempotency-Key', 'turn-key-corr')
        .send({ input_text: 'hello' })
        .expect(HttpStatus.CREATED);

      expect(res.headers['x-correlation-id']).toBe(correlationId);
      expect(res.body.correlation_id).toBe(correlationId);

      // Confirm correlation is stored in Audit log
      const audit = mockAuditDb.find((a) => a.action === 'turn_processed');
      expect(audit?.correlationId).toBe(correlationId);
    });

    it('18. should not update absolute expiration under turn extensions', async () => {
      const { session } = setupValidSession();
      const originalAbsolute = new Date(session.absoluteExpiresAt.getTime());

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'absolute-exp-key')
        .send({ input_text: 'check absolute' })
        .expect(HttpStatus.CREATED);

      const unchangedSession = mockSessionDb.find((s) => s.id === session.id);
      expect(unchangedSession?.absoluteExpiresAt.getTime()).toBe(
        originalAbsolute.getTime(),
      );
    });

    it('19. should record processingStartedAt timestamp during registration', async () => {
      const { session } = setupValidSession();

      await request(app.getHttpServer())
        .post(`/sessions/${session.id}/turns`)
        .set(getAuthHeader())
        .set('Idempotency-Key', 'started-at-key')
        .send({ input_text: 'record timestamp' })
        .expect(HttpStatus.CREATED);

      expect(mockTurnDb.length).toBe(1);
      expect(mockTurnDb[0].processingStartedAt).toBeInstanceOf(Date);
    });
  });
});
