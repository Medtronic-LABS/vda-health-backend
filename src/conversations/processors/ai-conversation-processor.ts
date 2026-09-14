import { Injectable, Inject, Logger } from '@nestjs/common';
import { IConversationProcessor } from '../interfaces/conversation-processor.interface';
import { IAiOrchestrator } from '../../ai/orchestration/ai-orchestrator.interface';
import { HostIdentity } from '../../auth/host-identity.context';

@Injectable()
export class AiConversationProcessor implements IConversationProcessor {
  private readonly logger = new Logger(AiConversationProcessor.name);

  constructor(
    @Inject('IAiOrchestrator')
    private readonly aiOrchestrator: IAiOrchestrator,
  ) {}

  async processTurn(
    sessionId: string,
    inputText: string,
    correlationId: string,
    identity: HostIdentity,
    consentArtifactId: string,
    prescriptionId?: string,
    prescriptionContextRequired?: boolean,
  ): Promise<{
    responseType: string;
    content: Record<string, any>;
    intent: string | null;
    selectedAgent: string | null;
    safetyStatus: string;
    safetyEscalation?: import('../../safety/interfaces/safety-gate.interface').SafetyResult;
  }> {
    this.logger.log(`[AiProcessor] Processing turn for sessionId=${sessionId}`);

    const result = await this.aiOrchestrator.orchestrateTurn({
      sessionId,
      inputText,
      correlationId,
      identity,
      vdaConsentArtifactId: consentArtifactId,
      prescriptionId,
      prescriptionContextRequired,
    });

    return {
      responseType: result.responseType,
      content: result.content,
      intent: result.intent,
      selectedAgent: result.selectedAgent,
      safetyStatus: result.safetyStatus,
      safetyEscalation: result.safetyEscalation,
    };
  }
}
