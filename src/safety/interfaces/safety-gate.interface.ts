export interface SafetyResult {
  status: 'SAFE' | 'ESCALATION_REQUIRED' | 'WITHHOLD' | 'INVALID_INPUT';
  ruleId: string | null;
  ruleVersion: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  action: string | null;
  patientSafeMessage: string | null;
  correlationId: string;
  language: string;
}

export interface ISafetyGate {
  evaluateSafety(
    text: string,
    correlationId: string,
    language?: string,
  ): Promise<SafetyResult>;
}
