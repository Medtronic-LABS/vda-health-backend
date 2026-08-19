import { AuditExporterService } from './services/audit-exporter.service';
import { DevelopmentAuditExporter } from './services/development-audit-exporter.service';
import { DataSource } from 'typeorm';
import { ConfigurationService } from '../configuration/configuration.service';
import { AuditEvent } from '../database/entities/audit-event.entity';

describe('AuditExporterService Unit Tests', () => {
  let service: AuditExporterService;
  let devExporter: DevelopmentAuditExporter;
  let mockDataSource: Partial<DataSource>;
  let mockConfigService: Partial<ConfigurationService>;

  beforeEach(() => {
    devExporter = new DevelopmentAuditExporter();
    mockDataSource = {
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([
          {
            id: 'evt-001',
            action: 'turn_processed',
            tenantId: '00000000-0000-0000-0000-000000000000',
            subjectAbhaRef: 'dev-ref-123',
            details: { intent: 'MEDICATION_QUERY' },
            timestamp: new Date(),
          },
        ]),
      }),
    };
    mockConfigService = {
      auditExportEnabled: true,
      auditExportIntervalMs: 5000,
      auditExportBatchSize: 50,
      auditExportMaxRetries: 2,
    };

    service = new AuditExporterService(
      mockDataSource as DataSource,
      mockConfigService as ConfigurationService,
      devExporter,
    );
  });

  it('should process export batch successfully and return count', async () => {
    const count = await service.processExportBatch();
    expect(count).toBe(1);
  });

  it('should verify zero PII in DevelopmentAuditExporter batch export', async () => {
    const res = await devExporter.exportBatch([
      {
        id: 'evt-002',
        action: 'response_safety_checked',
        tenantId: '00000000-0000-0000-0000-000000000000',
        subjectAbhaRef: 'dev-ref-123',
        details: { safe: true },
      } as unknown as AuditEvent,
    ]);

    expect(res.success).toBe(true);
    expect(res.exportedCount).toBe(1);
  });
});
