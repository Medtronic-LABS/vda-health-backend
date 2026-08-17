import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../interfaces/agent.interface';

@Injectable()
export class MedicationAgent implements IAgent {
  readonly agentId = 'medication-agent';

  async process(request: AgentProcessRequest): Promise<AgentProcessResult> {
    await Promise.resolve();
    const ctx = request.clinicalContext;
    const isHindi = request.intentMetadata.language === 'hi';

    if (!ctx || !ctx.medications || ctx.medications.length === 0) {
      return {
        agentId: this.agentId,
        responseType: 'medication',
        content: {
          hi: 'मुझे आपके रिकॉर्ड में वर्तमान दवाओं की जानकारी नहीं मिली।',
          en: 'No active medication records were found in your available health records.',
          medications: [],
        },
      };
    }

    const medList = ctx.medications.map((m) => ({
      name: m.medicationName,
      dosage: m.dosage,
      frequency: m.frequency,
      status: m.status,
    }));

    return {
      agentId: this.agentId,
      responseType: 'medication',
      content: {
        hi: isHindi
          ? `आपकी वर्तमान दवाएं: ${medList.map((m) => `${m.name} (${m.dosage || ''})`).join(', ')}`
          : `Your active medications: ${medList.map((m) => `${m.name} (${m.dosage || ''})`).join(', ')}`,
        en: `Your active medications: ${medList.map((m) => `${m.name} (${m.dosage || ''})`).join(', ')}`,
        medications: medList,
      },
    };
  }
}
