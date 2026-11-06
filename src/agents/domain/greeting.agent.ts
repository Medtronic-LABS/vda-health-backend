import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../interfaces/agent.interface';

@Injectable()
export class GreetingAgent implements IAgent {
  readonly agentId = 'greeting-agent';

  async process(request: AgentProcessRequest): Promise<AgentProcessResult> {
    void request;
    await Promise.resolve();
    return {
      agentId: this.agentId,
      responseType: 'text',
      content: {
        hi: 'नमस्ते! मैं VDA हूँ। आज मैं आपकी क्या मदद कर सकती हूँ?',
        en: 'Conversation processing is available in the prototype.',
      },
    };
  }
}
