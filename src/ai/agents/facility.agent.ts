/* eslint-disable */
import { Injectable, Logger } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../../agents/interfaces/agent.interface';

@Injectable()
export class FacilityAgent implements IAgent {
  readonly agentId = 'facility-agent';
  private readonly logger = new Logger(FacilityAgent.name);

  async process(input: AgentProcessRequest): Promise<AgentProcessResult> {
    const lang = input.intentMetadata?.language || 'hi';
    this.logger.log(
      `[FacilityAgent] Processing query="${input.inputText}" lang="${lang}"`,
    );

    const fallbackContent =
      lang === 'hi'
        ? {
            hi: 'प्राथमिक स्वास्थ्य केंद्र (PHC), सामुदायिक स्वास्थ्य केंद्र (CHC) और सरकारी अस्पतालों की जानकारी उपलब्ध है।',
            en: 'Primary Healthcare Centers (PHC), Community Healthcare Centers (CHC), and District Hospital services information is available.',
          }
        : {
            en: 'Primary Healthcare Centers (PHC), Community Healthcare Centers (CHC), and District Hospital services information is available.',
          };

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: fallbackContent,
    };
  }
}
