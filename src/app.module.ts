import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigurationModule } from './configuration/configuration.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { ConsentModule } from './consent/consent.module';
import { SessionsModule } from './sessions/sessions.module';
import { ConversationsModule } from './conversations/conversations.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { AgentsModule } from './agents/agents.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { RagModule } from './rag/rag.module';
import { AiModule } from './ai/ai.module';
import { PiiModule } from './pii/pii.module';
import { SafetyModule } from './safety/safety.module';
import { EscalationModule } from './escalation/escalation.module';
import { ReviewModule } from './review/review.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AbdmModule } from './abdm/abdm.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { AuditModule } from './audit/audit.module';
import { ObservabilityModule } from './observability/observability.module';
import { CommonModule } from './common/common.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { CorrelationIdMiddleware } from './observability/correlation-id.middleware';

@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    RedisModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    ConsentModule,
    SessionsModule,
    ConversationsModule,
    WorkflowsModule,
    OrchestrationModule,
    AgentsModule,
    KnowledgeModule,
    RagModule,
    AiModule,
    PiiModule,
    SafetyModule,
    EscalationModule,
    ReviewModule,
    NotificationsModule,
    AbdmModule,
    EvaluationModule,
    AuditModule,
    ObservabilityModule,
    CommonModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
