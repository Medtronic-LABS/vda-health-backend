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
        hi: 'नमस्ते! मैं आपका VDA स्वास्थ्य सहायक हूँ। आज मैं आपकी क्या सहायता कर सकता हूँ?',
        en: 'Conversation processing is available in the prototype.',
      },
    };
  }
}
