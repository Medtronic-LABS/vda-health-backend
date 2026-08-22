import { Injectable } from '@nestjs/common';
import {
  IAgent,
  AgentProcessRequest,
  AgentProcessResult,
} from '../../agents/interfaces/agent.interface';

/**
 * Presentation-facing NCD care navigation agent. Medication facts remain owned
 * by ClinicalContext/MedicationAgent; this agent supplies only the safe offline
 * path if an enabled LLM is not available.
 */
@Injectable()
export class AdherenceAgent implements IAgent {
  readonly agentId = 'adherence-agent';

  async process(input: AgentProcessRequest): Promise<AgentProcessResult> {
    const hi = input.intentMetadata?.language === 'hi';
    return {
      agentId: this.agentId,
      responseType: 'text',
      content: hi
        ? { hi: 'मैं आपकी दवा नियमित लेने और फॉलो-अप की योजना समझने में मदद कर सकता हूं। दवा की खुराक या समय में बदलाव के लिए अपने चिकित्सक से बात करें.' }
        : { en: 'I can help you plan regular medication use and follow-up. Please speak with your clinician before changing a dose or schedule.' },
    };
  }
}
