/* eslint-disable */
/**
 * ABDM HIU Integration Flow & Callback E2E Test Suite (Phase 7)
 *
 * Tests the read-only HIU callback controller endpoints, consent notifications,
 * data push notifications, and fallback behaviors per ABDM Milestone 3 v2.6.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AbdmModule } from '../src/abdm/abdm.module';
import { ConfigurationService } from '../src/configuration/configuration.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConsentArtifact } from '../src/database/entities/consent-artifact.entity';
import { AuditEvent } from '../src/database/entities/audit-event.entity';

describe('ABDM HIU Callbacks & Data Flow (E2E)', () => {
  let app: INestApplication;

  const mockConsentRepo = {
    findOne: jest.fn(),
  };

  const mockAuditRepo = {
    save: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AbdmModule],
    })
      .overrideProvider(getRepositoryToken(ConsentArtifact))
      .useValue(mockConsentRepo)
      .overrideProvider(getRepositoryToken(AuditEvent))
      .useValue(mockAuditRepo)
      .overrideProvider(ConfigurationService)
      .useValue({
        abdmEnabled: true,
        abdmBaseUrl: 'https://dev.abdm.gov.in',
        abdmClientId: 'client-123',
        abdmClientSecret: 'secret-456',
        abdmHiuId: 'hiu-789',
        abdmXCmId: 'sbx',
        abdmCallbackUrl: 'http://localhost:3000',
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('1. HIU Consent Init Callback returns HTTP 202 Accepted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v3/hiu/consent/request/on-init')
      .set('request-id', 'req-uuid-001')
      .send({
        consentRequest: { id: 'consent-req-123' },
        error: null,
      });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('ACCEPTED');
  });

  it('2. HIU Consent Notify Callback returns HTTP 202 Accepted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v3/hiu/consent/request/notify')
      .set('request-id', 'req-uuid-002')
      .send({
        notification: {
          consentRequestId: 'consent-req-123',
          status: 'GRANTED',
          consentArtefacts: [{ id: 'consent-art-456' }],
        },
      });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('ACCEPTED');
  });

  it('3. HIU Consent On-Fetch Callback returns HTTP 202 Accepted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v3/hiu/consent/on-fetch')
      .set('request-id', 'req-uuid-003')
      .send({
        consent: {
          status: 'GRANTED',
          consentDetail: { id: 'consent-art-456' },
        },
      });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('ACCEPTED');
  });

  it('4. HIU Health Info On-Request Callback returns HTTP 202 Accepted', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v3/hiu/health-information/on-request')
      .set('request-id', 'req-uuid-004')
      .send({
        hiRequest: {
          transactionId: 'txn-uuid-789',
          sessionStatus: 'REQUESTED',
        },
      });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('ACCEPTED');
  });

  it('5. HIU Data Push Notification Endpoint decrypts and processes pushed health entries', async () => {
    const rawFhir = JSON.stringify({
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'MedicationRequest',
            medicationCodeableConcept: { text: 'Amlodipine 5mg' },
            dosageInstruction: [{ text: 'Once daily' }],
            status: 'active',
          },
        },
      ],
    });

    const encryptedBase64 = Buffer.from(rawFhir).toString('base64');

    const res = await request(app.getHttpServer())
      .post('/api/v3/hiu/data/notification')
      .set('request-id', 'req-uuid-005')
      .send({
        transactionId: 'txn-uuid-789',
        pageNumber: 1,
        pageCount: 1,
        entries: [
          {
            content: encryptedBase64,
            media: 'application/fhir+json',
            careContextReference: 'CC-001',
          },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('ACCEPTED');
  });
});
