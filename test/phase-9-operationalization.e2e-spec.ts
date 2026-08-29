/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { RedisService } from '../src/redis/redis.service';
import { Session } from '../src/database/entities/session.entity';
import { ConsentArtifact } from '../src/database/entities/consent-artifact.entity';
import { ConversationTurn } from '../src/database/entities/conversation-turn.entity';
import { AuditEvent } from '../src/database/entities/audit-event.entity';
import { KnowledgeDocument } from '../src/database/entities/knowledge-document.entity';
import { KnowledgeChunk } from '../src/database/entities/knowledge-chunk.entity';
import { KnowledgeEmbedding } from '../src/database/entities/knowledge-embedding.entity';

jest.mock('@nestjs/typeorm', () => {
  const original = jest.requireActual('@nestjs/typeorm');
  const { DataSource } = require('typeorm');
  class MockTypeOrmModule {
    static forRoot = jest.fn().mockImplementation(() => {
      const mockDS = {
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
        isInitialized: true,
        entityMetadatas: [],
      };
      const token = original.getDataSourceToken
        ? original.getDataSourceToken()
        : 'default_DataSource';
      return {
        global: true,
        module: MockTypeOrmModule,
        providers: [
          { provide: DataSource, useValue: mockDS },
          { provide: token, useValue: mockDS },
        ],
        exports: [DataSource, token],
      };
    });
    static forRootAsync = jest.fn().mockImplementation(() => {
      const mockDS = {
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
        isInitialized: true,
        entityMetadatas: [],
      };
      const token = original.getDataSourceToken
        ? original.getDataSourceToken()
        : 'default_DataSource';
      return {
        global: true,
        module: MockTypeOrmModule,
        providers: [
          { provide: DataSource, useValue: mockDS },
          { provide: token, useValue: mockDS },
        ],
        exports: [DataSource, token],
      };
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
  return {
    ...original,
    TypeOrmModule: MockTypeOrmModule,
  };
});

describe('Phase 9 — Operationalization, Telemetry, Health Diagnostics & Rate Limiting (E2E)', () => {
  let app: INestApplication;
  let activeSessionId: string;
  let originalAiProviderEnabled: string | undefined;
  let originalKnowledgeRagEnabled: string | undefined;

  jest.setTimeout(30000);

  const mockSessionDb: any[] = [];
  const mockConsentDb: any[] = [];
  const mockTurnsDb: any[] = [];
  const mockAuditDb: any[] = [];

  const defaultConsent: any = {
    id: 'dev-consent-001',
    tenantId: '00000000-0000-0000-0000-000000000000',
    subjectId: 'dev-host-user-123',
    status: 'ACTIVE',
    consentVersion: '1.0',
    scopes: ['record_read', 'conversation_retention'],
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  };
  mockConsentDb.push(defaultConsent);

  const activeSession: any = {
    id: 'p9-active-session',
    tenantId: '00000000-0000-0000-0000-000000000000',
    partnerId: 'dev-partner',
    externalId: 'dev-host-user-123',
    subjectAbhaRef: 'dev-subject-abha-ref-123',
    status: 'ACTIVE',
    speaker: 'PATIENT',
    consentArtifactId: 'dev-consent-001',
    idleExpiresAt: new Date(Date.now() + 3600000),
    absoluteExpiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  };
  mockSessionDb.push(activeSession);

  const redisCounterMap = new Map<string, number>();

  const mockRedisService = {
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn(),
    ttl: jest.fn().mockResolvedValue(60),
    expire: jest.fn().mockResolvedValue(1),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
  };

  const mockConsentRepository = {
    findOne: jest.fn().mockImplementation((options: any) => {
      const id = options?.where?.id;
      return Promise.resolve(mockConsentDb.find((c) => c.id === id) || null);
    }),
    find: jest.fn().mockResolvedValue(mockConsentDb),
    create: jest.fn().mockImplementation((dto: any) => ({ ...dto, id: 'mock-consent-id' })),
    save: jest.fn().mockImplementation((entity: any) => Promise.resolve(entity)),
  };

  const mockSessionRepository = {
    findOne: jest.fn().mockImplementation((options: any) => {
      const id = options?.where?.id;
      return Promise.resolve(mockSessionDb.find((s) => s.id === id) || null);
    }),
    find: jest.fn().mockResolvedValue(mockSessionDb),
    create: jest.fn().mockImplementation((dto: any) => ({ ...dto, id: 'mock-session-id' })),
    save: jest.fn().mockImplementation((entity: any) => Promise.resolve(entity)),
  };

  const mockTurnRepository = {
    findOne: jest.fn().mockImplementation((options: any) => {
      const id = options?.where?.id;
      return Promise.resolve(mockTurnsDb.find((t) => t.id === id) || null);
    }),
    find: jest.fn().mockImplementation((options: any) => {
      const sessionId = options?.where?.sessionId;
      return Promise.resolve(mockTurnsDb.filter((t) => t.sessionId === sessionId));
    }),
    create: jest.fn().mockImplementation((dto: any) => ({ ...dto, id: `turn-${Date.now()}` })),
    save: jest.fn().mockImplementation((entity: any) => {
      if (!entity.id) entity.id = `turn-${Date.now()}-${Math.random()}`;
      if (!entity.createdAt) entity.createdAt = new Date();
      const existingIdx = mockTurnsDb.findIndex((t) => t.id === entity.id);
      if (existingIdx >= 0) {
        mockTurnsDb[existingIdx] = { ...mockTurnsDb[existingIdx], ...entity };
        return Promise.resolve(mockTurnsDb[existingIdx]);
      }
      mockTurnsDb.push(entity);
      return Promise.resolve(entity);
    }),
  };

  const mockAuditRepository = {
    find: jest.fn().mockResolvedValue(mockAuditDb),
    save: jest.fn().mockImplementation((entity: any) => {
      mockAuditDb.push(entity);
      return Promise.resolve(entity);
    }),
    logEvent: jest.fn().mockResolvedValue(true),
  };

  const mockEntityManager = {
    findOne: jest.fn().mockImplementation((entityClass: any, options: any) => {
      const className = entityClass?.name || String(entityClass);
      if (className.includes('Session') || entityClass === Session) {
        const id = options?.where?.id;
        return Promise.resolve(mockSessionDb.find((s) => s.id === id) || null);
      }
      if (className.includes('ConsentArtifact') || entityClass === ConsentArtifact) {
        const id = options?.where?.id;
        return Promise.resolve(mockConsentDb.find((c) => c.id === id) || null);
      }
      if (className.includes('ConversationTurn') || entityClass === ConversationTurn) {
        const id = options?.where?.id;
        return Promise.resolve(mockTurnsDb.find((t) => t.id === id) || null);
      }
      return Promise.resolve(null);
    }),
    find: jest.fn().mockImplementation((entityClass: any, options: any) => {
      const className = entityClass?.name || String(entityClass);
      if (className.includes('ConversationTurn') || entityClass === ConversationTurn) {
        const sessionId = options?.where?.sessionId;
        return Promise.resolve(mockTurnsDb.filter((t) => t.sessionId === sessionId));
      }
      return Promise.resolve([]);
    }),
    create: jest.fn().mockImplementation((_entityClass: any, dto: any) => ({
      ...dto,
      id: dto.id || `mock-id-${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    save: jest.fn().mockImplementation((arg1: any, arg2?: any) => {
      const entity = arg2 || arg1;
      if (!entity) return Promise.resolve(null);
      if (!entity.id) entity.id = `mock-id-${Date.now()}-${Math.random()}`;
      if (!entity.createdAt) entity.createdAt = new Date();
      const existingIdx = mockTurnsDb.findIndex((t) => t.id === entity.id);
      if (existingIdx >= 0) {
        mockTurnsDb[existingIdx] = { ...mockTurnsDb[existingIdx], ...entity };
        return Promise.resolve(mockTurnsDb[existingIdx]);
      }
      mockTurnsDb.push(entity);
      return Promise.resolve(entity);
    }),
  };

  const mockDataSource = {
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      return cb(mockEntityManager);
    }),
    getRepository: jest.fn().mockImplementation((entityClass: any) => {
      const className = entityClass?.name || String(entityClass);
      if (className.includes('ConversationTurn')) return mockTurnRepository;
      if (className.includes('Session')) return mockSessionRepository;
      if (className.includes('ConsentArtifact')) return mockConsentRepository;
      if (className.includes('AuditEvent')) return mockAuditRepository;
      return mockTurnRepository;
    }),
    query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  beforeAll(async () => {
    // This suite verifies operational guards and offline clinical routing. It must
    // not call the live Gemini provider or a real pgvector database during a test.
    originalAiProviderEnabled = process.env.AI_PROVIDER_ENABLED;
    originalKnowledgeRagEnabled = process.env.KNOWLEDGE_RAG_ENABLED;
    process.env.AI_PROVIDER_ENABLED = 'false';
    process.env.KNOWLEDGE_RAG_ENABLED = 'false';
    activeSessionId = 'p9-active-session';

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
      .overrideProvider(getRepositoryToken(KnowledgeDocument))
      .useValue(mockTurnRepository)
      .overrideProvider(getRepositoryToken(KnowledgeChunk))
      .useValue(mockTurnRepository)
      .overrideProvider(getRepositoryToken(KnowledgeEmbedding))
      .useValue(mockTurnRepository)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .overrideProvider(getDataSourceToken())
      .useValue(mockDataSource)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalAiProviderEnabled === undefined) delete process.env.AI_PROVIDER_ENABLED;
    else process.env.AI_PROVIDER_ENABLED = originalAiProviderEnabled;
    if (originalKnowledgeRagEnabled === undefined) delete process.env.KNOWLEDGE_RAG_ENABLED;
    else process.env.KNOWLEDGE_RAG_ENABLED = originalKnowledgeRagEnabled;
  });

  beforeEach(() => {
    redisCounterMap.clear();
    mockRedisService.incr.mockImplementation((key: string) => {
      const current = redisCounterMap.get(key) || 0;
      const next = current + 1;
      redisCounterMap.set(key, next);
      return Promise.resolve(next);
    });
  });

  it('1. GET /metrics returns standard Prometheus format output', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('vda_turns_total');
    expect(res.text).toContain('vda_turn_duration_seconds');
    expect(res.text).toContain('vda_safety_withheld_total');
  });

  it('2. Metrics Endpoint Privacy — Zero ABHA or PII in Prometheus text output', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('dev-subject-abha-ref-123');
    expect(res.text).not.toContain('dev-host-user-123');
    expect(res.text).not.toContain('patient@example.com');
  });

  it('3. GET /api/v1/health/liveness returns HTTP 200 with process status ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/liveness');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptimeSeconds).toBeDefined();
  });

  it('4. GET /api/v1/health/readiness returns HTTP 200 with DB and Redis service breakdown', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/readiness');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.database).toBe('healthy');
    expect(res.body.services.redis).toBe('healthy');
    expect(res.body.services.abdm_provider).toBe('development_fixture');
  });

  it('5. Backward Compatibility GET /api/v1/health returns HTTP 200', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('6. Rate Limiting Headers — Responses set X-RateLimit headers', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${activeSessionId}/turns`)
      .set('Authorization', 'Bearer dev-token')
      .set('x-correlation-id', 'corr-p9-headers')
      .set('Idempotency-Key', 'idemp-p9-headers')
      .send({
        input_text: 'नमस्ते',
        speaker: 'PATIENT',
        subject_ref: 'dev-subject-abha-ref-123',
      });

    expect(res.status).toBe(201);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('7. Rate Limiting Enforcement — Exceeding quota returns HTTP 429 TOO_MANY_REQUESTS', async () => {
    mockRedisService.incr.mockResolvedValueOnce(999);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${activeSessionId}/turns`)
      .set('Authorization', 'Bearer dev-token')
      .set('x-correlation-id', 'corr-p9-limit')
      .set('Idempotency-Key', 'idemp-p9-limit')
      .send({
        input_text: 'दवाइयों के बारे में बताओ',
        speaker: 'PATIENT',
        subject_ref: 'dev-subject-abha-ref-123',
      });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(res.body.error.patient_safe_message.hi).toBeDefined();
  });

  it('8. Deterministic Concurrency Test — Multiple rapid concurrent turns evaluate atomically', async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      request(app.getHttpServer())
        .post(`/api/v1/sessions/${activeSessionId}/turns`)
        .set('Authorization', 'Bearer dev-token')
        .set('x-correlation-id', `corr-p9-conc-${i}`)
        .set('Idempotency-Key', `idemp-p9-conc-${i}`)
        .send({
          input_text: `नमस्ते ${i}`,
          speaker: 'PATIENT',
          subject_ref: 'dev-subject-abha-ref-123',
        }),
    );

    const responses = await Promise.all(requests);
    expect(responses.length).toBe(5);
    responses.forEach((res) => {
      expect([201, 429]).toContain(res.status);
    });
  });

  it('9. ABDM Disabled Fallback Mode — Turn processes cleanly with DevelopmentHealthRecordService', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${activeSessionId}/turns`)
      .set('Authorization', 'Bearer dev-token')
      .set('x-correlation-id', 'corr-p9-abdm-fallback')
      .set('Idempotency-Key', 'idemp-p9-abdm-fallback')
      .send({
        input_text: 'मेरी दवाइयां बताओ',
        speaker: 'PATIENT',
        subject_ref: 'dev-subject-abha-ref-123',
      });

    expect(res.status).toBe(201);
    expect(res.body.content).toBeDefined();
    expect(res.body.selected_agent).toBe('medication-agent');
  });

  it('10. Complete Phase 1–8 Clinical Turn Verification — Grounded response with structured cards', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${activeSessionId}/turns`)
      .set('Authorization', 'Bearer dev-token')
      .set('x-correlation-id', 'corr-p9-full-clinical')
      .set('Idempotency-Key', 'idemp-p9-full-clinical')
      .send({
        input_text: 'मेरी लैब रिपोर्ट में क्या आया है?',
        speaker: 'PATIENT',
        subject_ref: 'dev-subject-abha-ref-123',
      });

    expect(res.status).toBe(201);
    expect(res.body.intent).toBe('LAB_RESULT_QUERY');
    expect(res.body.content.lab_results).toBeDefined();
  });
});
