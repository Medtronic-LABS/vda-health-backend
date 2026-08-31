import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../../agents/interfaces/agent.interface';

/**
 * Provides a governed navigation handoff only. It never creates an appointment
 * or claims a live provider integration where none is configured.
 */
@Injectable()
export class TeleconsultationAgent implements IAgent {
  readonly agentId = 'teleconsultation-agent';

  async process(input: AgentProcessRequest): Promise<AgentProcessResult> {
    const hi = input.intentMetadata.language.startsWith('hi');
    const officialUrl = 'https://esanjeevani.mohfw.gov.in/';
    const summary = hi
      ? `VDA के भीतर कोई लाइव टेलीकंसल्टेशन या डॉक्टर बुकिंग उपलब्ध नहीं है। आप आधिकारिक eSanjeevani सेवा पर जा सकते हैं: ${officialUrl}`
      : `No live teleconsultation or doctor booking is available within VDA. You can use the official eSanjeevani service: ${officialUrl}`;
    return {
      agentId: this.agentId,
      responseType: 'teleconsultation',
      content: {
        summary,
        ...(hi ? { hi: summary } : { en: summary }),
        teleconsultation: { status: 'EXTERNAL_NAVIGATION_ONLY', officialUrl },
      },
    };
  }
}
