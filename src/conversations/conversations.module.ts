import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { Session } from '../database/entities/session.entity';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { TurnsService } from './turns.service';
import { TurnsController } from './turns.controller';
import { AiConversationProcessor } from './processors/ai-conversation-processor';
import { ConversationResponseFormatter } from './formatters/conversation-response.formatter';
import { ConversationHistoryService } from './services/conversation-history.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PiiModule } from '../pii/pii.module';
import { SafetyModule } from '../safety/safety.module';
import { AiModule } from '../ai/ai.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { RedisModule } from '../redis/redis.module';
import { TenantRateLimiterGuard } from '../common/guards/tenant-rate-limiter.guard';
import { FacilityModule } from '../facilities/facility.module';
import { SyntheticPatient } from '../database/entities/synthetic-patient.entity';
import { EscalationModule } from '../escalation/escalation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationTurn, Session, ConsentArtifact, SyntheticPatient]),
    AuditModule,
    AuthModule,
    TenantsModule,
    PiiModule,
    SafetyModule,
    AiModule,
    ConfigurationModule,
    RedisModule,
    FacilityModule,
    EscalationModule,
  ],
  controllers: [TurnsController],
  providers: [
    TurnsService,
    AiConversationProcessor,
    ConversationResponseFormatter,
    ConversationHistoryService,
    TenantRateLimiterGuard,
    {
      provide: 'IConversationProcessor',
      useClass: AiConversationProcessor,
    },
  ],
  exports: [
    TurnsService,
    ConversationResponseFormatter,
    ConversationHistoryService,
  ],
})
export class ConversationsModule {}
