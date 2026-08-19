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
            hi: 'रेफरल प्रक्रियाओं और उच्च स्वास्थ्य केंद्रों (जिला अस्पताल/मेडिकल कॉलेज) में जाने के दिशा-निर्देश उपलब्ध हैं। आपातकालीन स्थिति में 108 पर संपर्क करें।',
            en: 'Referral protocols and guidance for secondary/tertiary care centers are available. Call 108 for emergency ambulance services.',
          }
        : {
            en: 'Referral protocols and guidance for secondary/tertiary care centers are available. Call 108 for emergency ambulance services.',
          };

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: fallbackContent,
    };
  }
}
