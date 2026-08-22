/* eslint-disable */
import { Injectable, Logger } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../../agents/interfaces/agent.interface';

@Injectable()
export class ReferralAgent implements IAgent {
  readonly agentId = 'referral-agent';
  private readonly logger = new Logger(ReferralAgent.name);

  async process(input: AgentProcessRequest): Promise<AgentProcessResult> {
    const lang = input.intentMetadata?.language || 'hi';
    this.logger.log(
      `[ReferralAgent] Processing query="${input.inputText}" lang="${lang}"`,
    );

    const fallbackContent =
      lang === 'hi'
        ? {
            hi: 'इस समय अनुमोदित रेफरल ज्ञान उपलब्ध नहीं है। लक्षण गंभीर या आपातकालीन हों तो स्थानीय आपातकालीन सेवा से संपर्क करें।',
            en: 'Approved referral knowledge is not available right now. Contact local emergency services for severe or emergency symptoms.',
          }
        : {
            en: 'Approved referral knowledge is not available right now. Contact local emergency services for severe or emergency symptoms.',
          };

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: fallbackContent,
    };
  }
}
