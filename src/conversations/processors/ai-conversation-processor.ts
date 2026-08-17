import { Injectable, Inject, Logger } from '@nestjs/common';
import { IConversationProcessor } from '../interfaces/conversation-processor.interface';
import { IAiOrchestrator } from '../../ai/orchestration/ai-orchestrator.interface';
import { HostIdentity } from '../../auth/host-identity.context';
import { ConfigurationService } from '../../configuration/configuration.service';

@Injectable()
export class AiConversationProcessor implements IConversationProcessor {
  private readonly logger = new Logger(AiConversationProcessor.name);

  constructor(
    @Inject('IAiOrchestrator')
    private readonly aiOrchestrator: IAiOrchestrator,
    private readonly configService: ConfigurationService,
  ) {}

  async processTurn(
    sessionId: string,
    inputText: string,
    correlationId: string,
  ): Promise<{
    responseType: string;
    content: Record<string, any>;
    intent: string | null;
    selectedAgent: string | null;
    safetyStatus: string;
  }> {
    this.logger.log(`[AiProcessor] Processing turn for sessionId=${sessionId}`);

    // Construct host identity context from configuration or defaults
    const identity: HostIdentity = {
      partnerId: this.configService.devAuthPartnerId || 'dev-partner',
      tenantId:
        this.configService.devAuthTenantId ||
        '00000000-0000-0000-0000-000000000000',
      externalId: this.configService.devAuthExternalId || 'dev-host-user-123',
      subjectAbhaRef:
        this.configService.devAuthSubjectAbhaRef || 'dev-subject-abha-ref-123',
      scopes: ['record_read', 'conversation_retention'],
    };

    const vdaConsentArtifactId = 'dev-consent-001';

    const result = await this.aiOrchestrator.orchestrateTurn({
      sessionId,
      inputText,
      correlationId,
      identity,
      vdaConsentArtifactId,
    });

    return {
      responseType: result.responseType,
      content: result.content,
      intent: result.intent,
      selectedAgent: result.selectedAgent,
      safetyStatus: result.safetyStatus,
    };
  }
}
