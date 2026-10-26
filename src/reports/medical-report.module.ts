import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConsentModule } from '../consent/consent.module';
import { MedicalReport } from '../database/entities/medical-report.entity';
import { Session } from '../database/entities/session.entity';
import { MedicalReportController } from './medical-report.controller';
import { MedicalReportService } from './medical-report.service';
import { ReportOcrService } from './report-ocr.service';

@Module({
  imports: [TypeOrmModule.forFeature([MedicalReport, Session]), AiModule, AuditModule, AuthModule, ConsentModule],
  controllers: [MedicalReportController],
  providers: [MedicalReportService, ReportOcrService],
  exports: [MedicalReportService],
})
export class MedicalReportModule {}
