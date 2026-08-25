import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { ConfigurationService } from '../configuration/configuration.service';
import { AuditModule } from '../audit/audit.module';
import { AbdmModule } from '../abdm/abdm.module';
import { SafetyModule } from '../safety/safety.module';
import { AgentsModule } from '../agents/agents.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

import { DevelopmentAiProvider } from './providers/development/development-ai.provider';
import { GeminiProvider } from './providers/gemini/gemini.provider';
import { DevelopmentLanguageProvider } from './providers/development/development-language.provider';
import { SarvamProvider } from './providers/sarvam/sarvam.provider';

import { IntentClassifierService } from './intents/intent-classifier.service';
import { AiOrchestratorService } from './orchestration/ai-orchestrator.service';

import { ConversationResponseFormatter } from '../conversations/formatters/conversation-response.formatter';
import { ConversationHistoryService } from '../conversations/services/conversation-history.service';

import { PiiModule } from '../pii/pii.module';

@Module({
  imports: [
    ConfigurationModule,
    AuditModule,
    AbdmModule,
    SafetyModule,
    AgentsModule,
    KnowledgeModule,
    PiiModule,
  ],
  providers: [
    DevelopmentAiProvider,
    GeminiProvider,
    DevelopmentLanguageProvider,
    SarvamProvider,
    ConversationResponseFormatter,
    ConversationHistoryService,
    {
      provide: 'IAiProvider',
      useFactory: (
        config: ConfigurationService,
        devProvider: DevelopmentAiProvider,
        geminiProvider: GeminiProvider,
      ) => {
        if (config.aiProviderEnabled && config.geminiApiKeys.length > 0) {
          return geminiProvider;
        }
        return devProvider;
      },
      inject: [ConfigurationService, DevelopmentAiProvider, GeminiProvider],
    },
    {
      provide: 'ILanguageProvider',
      useFactory: (
        config: ConfigurationService,
        devLang: DevelopmentLanguageProvider,
        sarvamProvider: SarvamProvider,
      ) => {
        if (config.sarvamEnabled && config.sarvamApiKey) {
          return sarvamProvider;
        }
        return devLang;
      },
      inject: [
        ConfigurationService,
        DevelopmentLanguageProvider,
        SarvamProvider,
      ],
    },
    {
      provide: 'IIntentClassifier',
      useClass: IntentClassifierService,
    },
    {
      provide: 'IAiOrchestrator',
      useClass: AiOrchestratorService,
    },
    AiOrchestratorService,
    IntentClassifierService,
  ],
  exports: [
    'IAiProvider',
    'ILanguageProvider',
    'IIntentClassifier',
    'IAiOrchestrator',
    AiOrchestratorService,
    IntentClassifierService,
    ConversationResponseFormatter,
    ConversationHistoryService,
  ],
})
export class AiModule {}
