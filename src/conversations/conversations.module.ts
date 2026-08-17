import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { Session } from '../database/entities/session.entity';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { TurnsService } from './turns.service';
import { TurnsController } from './turns.controller';
import { AiConversationProcessor } from './processors/ai-conversation-processor';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PiiModule } from '../pii/pii.module';
import { SafetyModule } from '../safety/safety.module';
import { AiModule } from '../ai/ai.module';
import { ConfigurationModule } from '../configuration/configuration.module';

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
  ],
  controllers: [TurnsController],
  providers: [
    TurnsService,
    AiConversationProcessor,
    {
      provide: 'IConversationProcessor',
      useClass: AiConversationProcessor,
    },
  ],
  exports: [TurnsService],
})
export class ConversationsModule {}
