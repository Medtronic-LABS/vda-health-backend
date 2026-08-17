import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../interfaces/agent.interface';

@Injectable()
export class GeneralHealthAgent implements IAgent {
  readonly agentId = 'general-health-agent';

  async process(request: AgentProcessRequest): Promise<AgentProcessResult> {
    void request;
    await Promise.resolve();
    return {
      agentId: this.agentId,
      responseType: 'text',
      content: {
        hi: 'मैं आपकी स्वास्थ्य संबंधी जानकारी में मदद कर सकता हूँ। क्या आप अपनी दवाओं, लैब रिपोर्ट या निदान के बारे में पूछना चाहते हैं?',
        en: 'Conversation processing is available in the prototype.',
      },
    };
  }
}
