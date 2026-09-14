import { HostIdentity } from '../../auth/host-identity.context';
import { SafetyResult } from '../../safety/interfaces/safety-gate.interface';

export interface IConversationProcessor {
  processTurn(
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
    safetyEscalation?: SafetyResult;
  }>;
}
