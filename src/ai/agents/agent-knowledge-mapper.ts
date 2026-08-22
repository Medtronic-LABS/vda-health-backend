export interface AgentDomainMapping {
  agentName: string;
  allowedDomains: string[];
  defaultDomain: string;
}

export class AgentKnowledgeMapper {
  private static readonly MAPPINGS: Record<string, AgentDomainMapping> = {
    'adherence-agent': {
      agentName: 'adherence-agent',
      allowedDomains: ['medication_education', 'preventive_health', 'public_health'],
      defaultDomain: 'preventive_health',
    },
    'medication-agent': {
      agentName: 'medication-agent',
      allowedDomains: ['medication', 'medication_education'],
      defaultDomain: 'medication',
    },
    'lab-report-agent': {
      agentName: 'lab-report-agent',
      allowedDomains: ['laboratory', 'diagnostic_education'],
      defaultDomain: 'laboratory',
    },
    'diagnosis-agent': {
      agentName: 'diagnosis-agent',
      allowedDomains: ['disease', 'clinical_guidelines'],
      defaultDomain: 'disease',
    },
    'general-health-agent': {
      agentName: 'general-health-agent',
      allowedDomains: ['preventive_health', 'lifestyle', 'public_health'],
      defaultDomain: 'preventive_health',
    },
    'scheme-agent': {
      agentName: 'scheme-agent',
      allowedDomains: ['government_schemes', 'ayushman_bharat'],
      defaultDomain: 'government_schemes',
    },
    'facility-agent': {
      agentName: 'facility-agent',
      allowedDomains: [
        'healthcare_facilities',
        'clinics',
        'PHC',
        'CHC',
        'hospitals',
      ],
      defaultDomain: 'healthcare_facilities',
    },
    'referral-agent': {
      agentName: 'referral-agent',
      allowedDomains: ['referral_protocols', 'healthcare_facilities'],
      defaultDomain: 'referral_protocols',
    },
    'teleconsultation-agent': {
      agentName: 'teleconsultation-agent',
      allowedDomains: ['telemedicine', 'teleconsultation', 'referral_protocols'],
      defaultDomain: 'telemedicine',
    },
  };

  /**
   * Resolves target domain for a given agent and intent.
   */
  static getTargetDomain(
    agentName: string,
    intentName?: string,
  ): string | undefined {
    const key = (agentName || '').toLowerCase();
    const mapping = this.MAPPINGS[key];
    if (!mapping) {
      if (intentName === 'GOVERNMENT_SCHEME_QUERY') return 'government_schemes';
      if (intentName === 'FACILITY_QUERY') return 'healthcare_facilities';
      if (intentName === 'REFERRAL_QUERY') return 'referral_protocols';
      return undefined;
    }
    return mapping.defaultDomain;
  }

  /**
   * Validates if an agent is authorized to access a domain.
   */
  static isDomainPermitted(agentName: string, domain: string): boolean {
    const key = (agentName || '').toLowerCase();
    const mapping = this.MAPPINGS[key];
    if (!mapping) return false;
    return mapping.allowedDomains.includes(domain);
  }
}
