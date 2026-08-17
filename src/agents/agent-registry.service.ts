import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IAgent } from './interfaces/agent.interface';
import { MedicationAgent } from './domain/medication.agent';
import { LabReportAgent } from './domain/lab-report.agent';
import { DiagnosisAgent } from './domain/diagnosis.agent';
import { AllergyAgent } from './domain/allergy.agent';
import { GeneralHealthAgent } from './domain/general-health.agent';
import { GreetingAgent } from './domain/greeting.agent';

@Injectable()
export class AgentRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AgentRegistryService.name);
  private readonly agents = new Map<string, IAgent>();

  constructor(
    private readonly medicationAgent: MedicationAgent,
    private readonly labReportAgent: LabReportAgent,
    private readonly diagnosisAgent: DiagnosisAgent,
    private readonly allergyAgent: AllergyAgent,
    private readonly generalHealthAgent: GeneralHealthAgent,
    private readonly greetingAgent: GreetingAgent,
  ) {}

  onModuleInit() {
    this.registerAgent(this.medicationAgent);
    this.registerAgent(this.labReportAgent);
    this.registerAgent(this.diagnosisAgent);
    this.registerAgent(this.allergyAgent);
    this.registerAgent(this.generalHealthAgent);
    this.registerAgent(this.greetingAgent);
  }

  registerAgent(agent: IAgent): void {
    this.agents.set(agent.agentId, agent);
    this.logger.log(`Registered agent: ${agent.agentId}`);
  }

  getAgent(agentId: string): IAgent {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn(
        `Agent ${agentId} not found, falling back to general-health-agent`,
      );
      return this.generalHealthAgent;
    }
    return agent;
  }
}
