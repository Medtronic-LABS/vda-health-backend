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
    const hi = input.intentMetadata?.language === 'hi';
    return {
      agentId: this.agentId,
      responseType: 'teleconsultation',
      content: hi
        ? { hi: 'टेलीकंसल्टेशन सेवा अगले चरण के लिए कॉन्फ़िगर है। आपातकालीन लक्षण हों तो तुरंत स्थानीय आपातकालीन सेवा से संपर्क करें.' }
        : { en: 'The teleconsultation service is configured for the next step. If you have emergency symptoms, contact local emergency services immediately.' },
    };
  }
}
