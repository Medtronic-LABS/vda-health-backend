import { Injectable, Logger } from '@nestjs/common';
import { IAgent } from './interfaces/agent.interface';
import { AgentRegistryService } from './agent-registry.service';
import { IntentType } from '../ai/intents/intent.types';

@Injectable()
export class AgentRouterService {
  private readonly logger = new Logger(AgentRouterService.name);

  constructor(private readonly agentRegistry: AgentRegistryService) {}

  selectAgent(intent: IntentType): IAgent {
    let agentId = 'general-health-agent';

    switch (intent) {
      case IntentType.MEDICATION_QUERY:
      case IntentType.PRESCRIPTION_QUERY:
        agentId = 'medication-agent';
        break;
      case IntentType.LAB_RESULT_QUERY:
        agentId = 'lab-report-agent';
        break;
      case IntentType.DIAGNOSIS_QUERY:
        agentId = 'diagnosis-agent';
        break;
      case IntentType.ALLERGY_QUERY:
        agentId = 'allergy-agent';
        break;
      case IntentType.GOVERNMENT_SCHEME_QUERY:
        agentId = 'scheme-agent';
        break;
      case IntentType.FACILITY_QUERY:
        agentId = 'facility-agent';
        break;
      case IntentType.REFERRAL_QUERY:
        agentId = 'referral-agent';
        break;
      case IntentType.GENERAL_HEALTH_QUERY:
      case IntentType.CLARIFICATION:
      case IntentType.UNKNOWN:
      default:
        agentId = 'general-health-agent';
        break;
    }

    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      this.logger.warn(
        `Agent '${agentId}' not found in registry. Falling back to 'general-health-agent'.`,
      );
      return (
        this.agentRegistry.getAgent('general-health-agent') ||
        this.agentRegistry.getAgent('greeting-agent')
      );
    }

    return agent;
  }
}
