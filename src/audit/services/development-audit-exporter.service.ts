import { Injectable, Logger } from '@nestjs/common';
import {
  IAuditExporter,
  AuditExporterResult,
} from '../interfaces/audit-exporter.interface';
import { AuditEvent } from '../../database/entities/audit-event.entity';

@Injectable()
export class DevelopmentAuditExporter implements IAuditExporter {
  private readonly logger = new Logger(DevelopmentAuditExporter.name);

  async exportBatch(events: AuditEvent[]): Promise<AuditExporterResult> {
    if (!events || events.length === 0) {
      return { exportedCount: 0, success: true };
    }

    this.logger.log(
      `[DEV_AUDIT_EXPORTER] Processing batch export count=${events.length}`,
    );

    // Verify zero PII/secret in payload
    for (const evt of events) {
      const detailsStr = JSON.stringify(evt.details || {});
      if (
        detailsStr.includes('@') ||
        detailsStr.includes('Bearer ') ||
        detailsStr.includes('0x')
      ) {
        this.logger.warn(
          `[DEV_AUDIT_EXPORTER] Detected potential sensitive token in audit id=${evt.id}`,
        );
      }
    }

    await Promise.resolve();
    return {
      exportedCount: events.length,
      success: true,
    };
  }
}
