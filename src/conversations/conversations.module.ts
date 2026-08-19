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

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationTurn, Session, ConsentArtifact]),
    AuditModule,
    AuthModule,
    TenantsModule,
    PiiModule,
    SafetyModule,
    AiModule,
    ConfigurationModule,
    RedisModule,
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
