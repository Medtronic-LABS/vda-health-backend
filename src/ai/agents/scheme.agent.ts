/* eslint-disable */
import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../../agents/interfaces/agent.interface';

@Injectable()
export class SchemeAgent implements IAgent {
  readonly agentId = 'scheme-agent';

  async process(input: AgentProcessRequest): Promise<AgentProcessResult> {
    const hi = input.intentMetadata.language.startsWith('hi');
    const unavailable = hi
      ? 'मुझे इस योजना के लिए अनुमोदित जानकारी तैयार करने में समस्या हो रही है। कृपया थोड़ी देर बाद फिर प्रयास करें।'
      : 'I cannot prepare an approved response for this scheme right now. Please try again shortly.';

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: {
        summary: unavailable,
        ...(hi ? { hi: unavailable } : { en: unavailable }),
      },
    };
  }
}
