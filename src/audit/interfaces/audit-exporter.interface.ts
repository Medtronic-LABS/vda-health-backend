import { AuditEvent } from '../../database/entities/audit-event.entity';

export interface AuditExporterResult {
  exportedCount: number;
  success: boolean;
  error?: string;
}

export interface IAuditExporter {
  exportBatch(events: AuditEvent[]): Promise<AuditExporterResult>;
}
