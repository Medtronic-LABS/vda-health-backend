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
            hi: 'आयुष्मान भारत और सरकारी स्वास्थ्य योजनाओं के बारे में जानकारी उपलब्ध है। आप पात्रता, मुफ्त इलाज सीमा और आवश्यक दस्तावेजों के बारे में पूछ सकते हैं।',
            en: 'Ayushman Bharat and Government Health Schemes information is available. You can ask about eligibility, treatment coverage, and required documents.',
          }
        : {
            en: 'Ayushman Bharat and Government Health Schemes information is available. You can ask about eligibility, treatment coverage, and required documents.',
          };

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: fallbackContent,
    };
  }
}
