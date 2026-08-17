import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../interfaces/agent.interface';

@Injectable()
export class DiagnosisAgent implements IAgent {
  readonly agentId = 'diagnosis-agent';

  async process(request: AgentProcessRequest): Promise<AgentProcessResult> {
    await Promise.resolve();
    const ctx = request.clinicalContext;

    if (!ctx || !ctx.diagnoses || ctx.diagnoses.length === 0) {
      return {
        agentId: this.agentId,
        responseType: 'text',
        content: {
          hi: 'मुझे आपके स्वास्थ्य रिकॉर्ड में किसी निदान की जानकारी नहीं मिली।',
          en: 'No active diagnosis records were found in your available health records.',
          diagnoses: [],
        },
      };
    }

    const diagList = ctx.diagnoses.map((d) => ({
      condition: d.conditionName,
      status: d.status,
    }));

    return {
      agentId: this.agentId,
      responseType: 'text',
      content: {
        hi: `आपके रिकॉर्ड के अनुसार स्थिति: ${diagList.map((d) => d.condition).join(', ')}`,
        en: `Diagnosed conditions in your records: ${diagList.map((d) => d.condition).join(', ')}`,
        diagnoses: diagList,
      },
    };
  }
}
