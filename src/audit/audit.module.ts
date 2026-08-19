import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEvent } from '../database/entities/audit-event.entity';
import { AuditService } from './audit.service';
import { DevelopmentAuditExporter } from './services/development-audit-exporter.service';
import { AuditExporterService } from './services/audit-exporter.service';
import { ConfigurationModule } from '../configuration/configuration.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent]), ConfigurationModule],
  providers: [
    AuditService,
    DevelopmentAuditExporter,
    AuditExporterService,
    {
      provide: 'IAuditExporter',
      useClass: DevelopmentAuditExporter,
    },
  ],
  exports: [AuditService, AuditExporterService, 'IAuditExporter'],
})
export class AuditModule {}
