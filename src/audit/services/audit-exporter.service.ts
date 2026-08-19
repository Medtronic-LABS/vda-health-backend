import {
  Injectable,
  Logger,
  Inject,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditEvent } from '../../database/entities/audit-event.entity';
import { IAuditExporter } from '../interfaces/audit-exporter.interface';
import { ConfigurationService } from '../../configuration/configuration.service';

@Injectable()
export class AuditExporterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditExporterService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    @Optional()
    private readonly dataSource?: DataSource,
    @Optional()
    private readonly configService?: ConfigurationService,
    @Optional()
    @Inject('IAuditExporter')
    private readonly exporter?: IAuditExporter,
  ) {}

  onModuleInit(): void {
    if (!this.configService?.auditExportEnabled) {
      this.logger.log('Audit event background export is disabled.');
      return;
    }

    const interval = this.configService?.auditExportIntervalMs || 5000;
    this.logger.log(
      `Starting background audit exporter loop intervalMs=${interval}`,
    );

    this.timer = setInterval(() => {
      this.processExportBatch().catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Audit export batch loop error: ${errMsg}`);
      });
    }, interval);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processExportBatch(): Promise<number> {
    if (this.isProcessing || !this.dataSource || !this.exporter) return 0;
    this.isProcessing = true;

    try {
      const auditRepo = this.dataSource.getRepository(AuditEvent);
      const batchSize = this.configService?.auditExportBatchSize || 50;

      // Query recent audit records
      const events = await auditRepo.find({
        order: { timestamp: 'DESC' },
        take: batchSize,
      });

      if (events.length === 0) {
        return 0;
      }

      let attempt = 0;
      let success = false;
      const maxRetries = this.configService?.auditExportMaxRetries || 3;

      while (attempt < maxRetries && !success) {
        attempt++;
        try {
          const res = await this.exporter.exportBatch(events);
          if (res.success) {
            success = true;
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Audit export attempt ${attempt}/${maxRetries} failed: ${errMsg}`,
          );
        }
      }

      if (!success) {
        this.logger.error(
          `Audit batch export failed after ${maxRetries} retries. Records remain preserved in DB.`,
        );
        return 0;
      }

      return events.length;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Audit batch retrieval failed: ${errMsg}`);
      return 0;
    } finally {
      this.isProcessing = false;
    }
  }
}
