import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../interfaces/agent.interface';

@Injectable()
export class AllergyAgent implements IAgent {
  readonly agentId = 'allergy-agent';

  async process(request: AgentProcessRequest): Promise<AgentProcessResult> {
    await Promise.resolve();
    const ctx = request.clinicalContext;

    if (!ctx || !ctx.allergies || ctx.allergies.length === 0) {
      return {
        agentId: this.agentId,
        responseType: 'text',
        content: {
          hi: 'मुझे आपके रिकॉर्ड में किसी एलर्जन (Allergy) की जानकारी नहीं मिली।',
          en: 'No active allergy records were found in your available health records.',
          allergies: [],
        },
      };
    }

    const allergyList = ctx.allergies.map((a) => ({
      allergen: a.allergen,
      severity: a.severity,
    }));

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: {
        hi: `आपकी दर्ज एलर्जी: ${allergyList.map((a) => a.allergen).join(', ')}`,
        en: `Your recorded allergies: ${allergyList.map((a) => a.allergen).join(', ')}`,
        allergies: allergyList,
      },
    };
  }
}
