import { HostIdentity } from '../../auth/host-identity.context';
import { SafetyResult } from '../../safety/interfaces/safety-gate.interface';

export interface AiOrchestratorRequest {
  sessionId: string;
  inputText: string;
  correlationId: string;
  identity: HostIdentity;
  vdaConsentArtifactId: string;
  language?: string;
  /** Exact uploaded prescription record for an isolated prescription explanation turn. */
  prescriptionId?: string;
  /** Fail closed when a prescription-only question has no active safe context. */
  prescriptionContextRequired?: boolean;
}

export interface AiOrchestratorResult {
  responseType: string;
  content: Record<string, any>;
  intent: string;
  selectedAgent: string;
  safetyStatus: string;
  /** Present only when the post-generation SafetyGate required escalation. */
  safetyEscalation?: SafetyResult;
  latencyMs: number;
}

export interface IAiOrchestrator {
  orchestrateTurn(
    request: AiOrchestratorRequest,
  ): Promise<AiOrchestratorResult>;
}
