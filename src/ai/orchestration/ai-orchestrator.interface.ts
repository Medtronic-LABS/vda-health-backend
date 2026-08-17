import { HostIdentity } from '../../auth/host-identity.context';

export interface AiOrchestratorRequest {
  sessionId: string;
  inputText: string;
  correlationId: string;
  identity: HostIdentity;
  vdaConsentArtifactId: string;
  language?: string;
}

export interface AiOrchestratorResult {
  responseType: string;
  content: Record<string, any>;
  intent: string;
  selectedAgent: string;
  safetyStatus: string;
  latencyMs: number;
}

export interface IAiOrchestrator {
  orchestrateTurn(
    request: AiOrchestratorRequest,
  ): Promise<AiOrchestratorResult>;
}
