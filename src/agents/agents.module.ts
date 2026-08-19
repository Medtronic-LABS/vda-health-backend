import { Module } from '@nestjs/common';
import { MedicationAgent } from './domain/medication.agent';
import { LabReportAgent } from './domain/lab-report.agent';
import { DiagnosisAgent } from './domain/diagnosis.agent';
import { AllergyAgent } from './domain/allergy.agent';
import { GeneralHealthAgent } from './domain/general-health.agent';
import { GreetingAgent } from './domain/greeting.agent';
import { AgentRegistryService } from './agent-registry.service';
import { AgentRouterService } from './agent-router.service';

import { SchemeAgent } from '../ai/agents/scheme.agent';
import { FacilityAgent } from '../ai/agents/facility.agent';
import { ReferralAgent } from '../ai/agents/referral.agent';

@Module({
  providers: [
    MedicationAgent,
    LabReportAgent,
    DiagnosisAgent,
    AllergyAgent,
    GeneralHealthAgent,
    GreetingAgent,
    SchemeAgent,
    FacilityAgent,
    ReferralAgent,
    AgentRegistryService,
    AgentRouterService,
  ],
  exports: [
    AgentRegistryService,
    AgentRouterService,
    SchemeAgent,
    FacilityAgent,
    ReferralAgent,
  ],
})
export class AgentsModule {}
