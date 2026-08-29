import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { ClinicalEscalation } from '../database/entities/clinical-escalation.entity';
import { ClinicalEscalationAccessGuard } from './clinical-escalation-access.guard';
import { EscalationController } from './escalation.controller';
import { EscalationService } from './escalation.service';

@Module({
  imports: [TypeOrmModule.forFeature([ClinicalEscalation]), AuthModule, AuditModule, ConfigurationModule],
  controllers: [EscalationController],
  providers: [EscalationService, ClinicalEscalationAccessGuard],
  exports: [EscalationService],
})
export class EscalationModule {}
