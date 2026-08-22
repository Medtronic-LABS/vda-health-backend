/* eslint-disable */
import { Injectable, Logger } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../../agents/interfaces/agent.interface';

@Injectable()
export class SchemeAgent implements IAgent {
  readonly agentId = 'scheme-agent';
  private readonly logger = new Logger(SchemeAgent.name);

  async process(input: AgentProcessRequest): Promise<AgentProcessResult> {
    const lang = input.intentMetadata?.language || 'hi';
    this.logger.log(
      `[SchemeAgent] Processing query="${input.inputText}" lang="${lang}"`,
    );

    const fallbackContent =
      lang === 'hi'
        ? {
            hi: 'इस समय अनुमोदित योजना ज्ञान उपलब्ध नहीं है। कृपया वर्तमान आधिकारिक पात्रता मानदंड से सत्यापन करें।',
            en: 'Approved scheme knowledge is not available right now. Please verify eligibility against current official criteria.',
          }
        : {
            en: 'Approved scheme knowledge is not available right now. Please verify eligibility against current official criteria.',
          };

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: fallbackContent,
    };
  }
}
