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
        ? { summary: 'टेलीकंसल्टेशन डेमो शुरू हो गया है। यह केवल डेमो है; कोई वास्तविक डॉक्टर या अपॉइंटमेंट बुक नहीं किया गया है। अगला चरण: डेमो कंसल्टेशन स्थिति देखें।', hi: 'टेलीकंसल्टेशन डेमो शुरू हो गया है। यह केवल डेमो है; कोई वास्तविक डॉक्टर या अपॉइंटमेंट बुक नहीं किया गया है। अगला चरण: डेमो कंसल्टेशन स्थिति देखें।', teleconsultation: { status: 'DEMO_STARTED', consultationState: 'DEMO_PENDING', mode: 'DEMO_ONLY', nextStep: 'VIEW_DEMO_CONSULTATION_STATUS' } }
        : { summary: 'Teleconsultation demo started. This is DEMO ONLY; no real doctor or appointment has been created. Next step: view the demo consultation status.', en: 'Teleconsultation demo started. This is DEMO ONLY; no real doctor or appointment has been created. Next step: view the demo consultation status.', teleconsultation: { status: 'DEMO_STARTED', consultationState: 'DEMO_PENDING', mode: 'DEMO_ONLY', nextStep: 'VIEW_DEMO_CONSULTATION_STATUS' } },
    };
  }
}
