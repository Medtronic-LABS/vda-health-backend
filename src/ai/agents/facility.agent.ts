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
            hi: 'इस स्थान के लिए अनुमोदित सुविधा ज्ञान उपलब्ध नहीं है। मैं अस्पताल या क्लिनिक का नाम नहीं बना सकता।',
            en: 'Approved facility knowledge is not available for this location. I cannot invent a hospital or clinic.',
          }
        : {
            en: 'Approved facility knowledge is not available for this location. I cannot invent a hospital or clinic.',
          };

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: fallbackContent,
    };
  }
}
