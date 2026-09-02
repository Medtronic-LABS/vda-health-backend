import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { ClinicalEscalation } from '../database/entities/clinical-escalation.entity';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { Session } from '../database/entities/session.entity';
import { RedisModule } from '../redis/redis.module';
import { DevDemoModule } from '../dev/dev-demo.module';
import { FacilityModule } from '../facilities/facility.module';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { ClinicalEscalationAccessGuard } from './clinical-escalation-access.guard';
import { EscalationController, PatientClinicalReviewController } from './escalation.controller';
import { EscalationService } from './escalation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClinicalEscalation, ConversationTurn, Session]),
    AuthModule,
    AuditModule,
    ConfigurationModule,
    RedisModule,
    DevDemoModule,
    FacilityModule,
  ],
  controllers: [EscalationController, PatientClinicalReviewController],
  providers: [EscalationService, ClinicalEscalationAccessGuard, IdempotencyInterceptor],
  exports: [EscalationService],
})
export class EscalationModule {}
