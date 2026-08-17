export interface AgentConfig {
  agentId: string;
  version: string;
  purpose: string;
  allowedTools: string[];
  allowedKnowledgeDomains: string[];
  systemInstructions: string;
  outputContract: Record<string, any>;
  safetyConstraints: Record<string, any>;
}

export interface AgentInput {
  query: string;
  context: Record<string, any>;
  history: any[];
}

export interface AgentOutput {
  responseType: string;
  payload: Record<string, any>;
  confidence?: number;
  metadata?: Record<string, any>;
}

export interface IAgent {
  getConfig(): AgentConfig;
  execute(input: AgentInput): Promise<AgentOutput>;
}
