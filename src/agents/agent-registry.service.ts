/* eslint-disable */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { IAgent } from './interfaces/agent.interface';
import { MedicationAgent } from './domain/medication.agent';
import { LabReportAgent } from './domain/lab-report.agent';
import { DiagnosisAgent } from './domain/diagnosis.agent';
import { AllergyAgent } from './domain/allergy.agent';
import { GeneralHealthAgent } from './domain/general-health.agent';
import { GreetingAgent } from './domain/greeting.agent';
import { SchemeAgent } from '../ai/agents/scheme.agent';
import { FacilityAgent } from '../ai/agents/facility.agent';
import { ReferralAgent } from '../ai/agents/referral.agent';

@Injectable()
export class AgentRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AgentRegistryService.name);
  private readonly agents = new Map<string, IAgent>();

  constructor(
    @Optional() private readonly medicationAgent?: MedicationAgent,
    @Optional() private readonly labReportAgent?: LabReportAgent,
    @Optional() private readonly diagnosisAgent?: DiagnosisAgent,
    @Optional() private readonly allergyAgent?: AllergyAgent,
    @Optional() private readonly generalHealthAgent?: GeneralHealthAgent,
    @Optional() private readonly greetingAgent?: GreetingAgent,
    @Optional() private readonly schemeAgent?: SchemeAgent,
    @Optional() private readonly facilityAgent?: FacilityAgent,
    @Optional() private readonly referralAgent?: ReferralAgent,
  ) {}

  onModuleInit() {
    if (this.medicationAgent) this.registerAgent(this.medicationAgent);
    if (this.labReportAgent) this.registerAgent(this.labReportAgent);
    if (this.diagnosisAgent) this.registerAgent(this.diagnosisAgent);
    if (this.allergyAgent) this.registerAgent(this.allergyAgent);
    if (this.generalHealthAgent) this.registerAgent(this.generalHealthAgent);
    if (this.greetingAgent) this.registerAgent(this.greetingAgent);
    if (this.schemeAgent) this.registerAgent(this.schemeAgent);
    if (this.facilityAgent) this.registerAgent(this.facilityAgent);
    if (this.referralAgent) this.registerAgent(this.referralAgent);
  }

  registerAgent(agent: IAgent): void {
    if (agent && agent.agentId) {
      this.agents.set(agent.agentId, agent);
      this.logger.log(`Registered agent: ${agent.agentId}`);
    }
  }

  getAgent(agentId: string): IAgent {
    if (this.agents.size === 0) {
      this.onModuleInit();
    }
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn(
        `Agent ${agentId} not found, falling back to general-health-agent`,
      );
      return (this.generalHealthAgent || this.greetingAgent)!;
    }
    return agent;
  }
}
