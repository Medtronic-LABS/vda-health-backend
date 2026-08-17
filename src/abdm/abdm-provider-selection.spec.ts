import { Test, TestingModule } from '@nestjs/testing';
import { AbdmModule } from './abdm.module';
import { ConfigurationService } from '../configuration/configuration.service';
import { DevelopmentHealthRecordService } from './services/development-health-record.service';
import { AbdmHealthRecordService } from './services/abdm-health-record.service';
import {
  IHealthRecordService,
  HealthRecordCategory,
} from './interfaces/health-record-service.interface';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { AuditEvent } from '../database/entities/audit-event.entity';

describe('ABDM Provider Selection & Offline Foundation (Phase 7)', () => {
  let moduleRef: TestingModule;

  const mockConsentRepo = {
    findOne: jest.fn(),
  };

  const mockAuditRepo = {
    save: jest.fn(),
  };

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('1. ABDM_ENABLED=false selects DevelopmentHealthRecordService', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AbdmModule],
    })
      .overrideProvider(getRepositoryToken(ConsentArtifact))
      .useValue(mockConsentRepo)
      .overrideProvider(getRepositoryToken(AuditEvent))
      .useValue(mockAuditRepo)
      .overrideProvider(ConfigurationService)
      .useValue({
        abdmEnabled: false,
        abdmBaseUrl: undefined,
        abdmClientId: undefined,
        abdmClientSecret: undefined,
        abdmHiuId: undefined,
      })
      .compile();

    const provider = moduleRef.get<IHealthRecordService>(
      'IHealthRecordService',
    );
    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(DevelopmentHealthRecordService);
    expect(provider).not.toBeInstanceOf(AbdmHealthRecordService);
  });

  it('2. ABDM_ENABLED=true with valid credentials selects AbdmHealthRecordService', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AbdmModule],
    })
      .overrideProvider(getRepositoryToken(ConsentArtifact))
      .useValue(mockConsentRepo)
      .overrideProvider(getRepositoryToken(AuditEvent))
      .useValue(mockAuditRepo)
      .overrideProvider(ConfigurationService)
      .useValue({
        abdmEnabled: true,
        abdmBaseUrl: 'https://gateway.abdm.gov.in',
        abdmClientId: 'client-123',
        abdmClientSecret: 'secret-456',
        abdmHiuId: 'hiu-789',
      })
      .compile();

    const provider = moduleRef.get<IHealthRecordService>(
      'IHealthRecordService',
    );
    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(AbdmHealthRecordService);
  });

  it('3. ABDM_ENABLED=true with missing credentials safely falls back to DevelopmentHealthRecordService without crashing', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AbdmModule],
    })
      .overrideProvider(getRepositoryToken(ConsentArtifact))
      .useValue(mockConsentRepo)
      .overrideProvider(getRepositoryToken(AuditEvent))
      .useValue(mockAuditRepo)
      .overrideProvider(ConfigurationService)
      .useValue({
        abdmEnabled: true,
        abdmBaseUrl: '', // Missing
        abdmClientId: '',
        abdmClientSecret: '',
        abdmHiuId: '',
      })
      .compile();

    const provider = moduleRef.get<IHealthRecordService>(
      'IHealthRecordService',
    );
    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(DevelopmentHealthRecordService);
  });

  it('4. DevelopmentHealthRecordService returns synthetic records marked as fixtures', async () => {
    const devService = new DevelopmentHealthRecordService();
    const result = await devService.fetchRecords({
      subjectContext: {
        sessionId: 'test-session',
        tenantId: '00000000-0000-0000-0000-000000000000',
        subjectAbhaRef: 'dev-subject-abha-ref-123',
        correlationId: 'test-corr-id',
        abdmConsentArtefactRef: 'dev-consent-001',
      },
      categories: [
        HealthRecordCategory.MEDICATION,
        HealthRecordCategory.LAB_REPORT,
      ],
    });

    expect(result.bundles.length).toBe(2);
    expect(result.unavailableCategories.length).toBe(0);
    const medBundle = result.bundles.find(
      (b) => b.category === HealthRecordCategory.MEDICATION,
    );
    expect(medBundle).toBeDefined();
    expect(medBundle!.records[0].sourceRef).toContain(
      '[SYNTHETIC-DEV-FIXTURE]',
    );
  });
});
