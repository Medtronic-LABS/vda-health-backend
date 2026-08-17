import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../interfaces/agent.interface';

@Injectable()
export class LabReportAgent implements IAgent {
  readonly agentId = 'lab-report-agent';

  async process(request: AgentProcessRequest): Promise<AgentProcessResult> {
    await Promise.resolve();
    const ctx = request.clinicalContext;

    if (!ctx || !ctx.labResults || ctx.labResults.length === 0) {
      return {
        agentId: this.agentId,
        responseType: 'trend_vital',
        content: {
          hi: 'मुझे आपके स्वास्थ्य रिकॉर्ड में हाल की लैब रिपोर्ट नहीं मिली।',
          en: 'No recent laboratory reports were found in your available health records.',
          labResults: [],
        },
      };
    }

    const labList = ctx.labResults.map((l) => ({
      test: l.testName,
      value: l.value,
      unit: l.unit,
      interpretation: l.interpretation,
    }));

    return {
      agentId: this.agentId,
      responseType: 'trend_vital',
      content: {
        hi: `आपकी लैब रिपोर्ट: ${labList.map((l) => `${l.test}: ${l.value || ''} ${l.unit || ''}`).join(', ')}`,
        en: `Your lab report results: ${labList.map((l) => `${l.test}: ${l.value || ''} ${l.unit || ''}`).join(', ')}`,
        labResults: labList,
      },
    };
  }
}
