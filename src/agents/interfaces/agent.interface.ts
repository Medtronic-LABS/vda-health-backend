import { ClinicalContext } from '../../abdm/models/clinical-context.models';
import { IntentMetadata } from '../../ai/intents/intent.types';

export interface AgentProcessRequest {
  sessionId: string;
  inputText: string;
  intentMetadata: IntentMetadata;
  clinicalContext?: ClinicalContext | null;
  correlationId: string;
}

export interface AgentProcessResult {
  agentId: string;
  responseType: string;
  content: Record<string, any>;
  suggestedFollowUp?: string[];
}

export interface IAgent {
  readonly agentId: string;
  process(request: AgentProcessRequest): Promise<AgentProcessResult>;
}
