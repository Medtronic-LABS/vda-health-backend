import { Injectable } from '@nestjs/common';
import { IntentType } from '../../ai/intents/intent.types';

export interface NormalizedKnowledgeQuery {
  query: string;
  district?: string;
  state?: string;
  normalized: boolean;
}

/**
 * Produces a constrained retrieval-only query. The original patient message is
 * retained for ClinicalContext, history, and response generation.
 */
@Injectable()
export class KnowledgeQueryNormalizerService {
  normalize(
    patientQuery: string,
    language: string,
    intent: IntentType,
  ): NormalizedKnowledgeQuery {
    const lower = patientQuery.toLowerCase();
    const location = this.extractLocation(lower);
    const needsNormalization = language === 'hi' || language === 'hi-Latn';

    if (!needsNormalization) {
      return { query: patientQuery, ...location, normalized: false };
    }

    const byIntent: Partial<Record<IntentType, string>> = {
      [IntentType.ADHERENCE_QUERY]:
        'I forget to take my medicines regularly medication adherence',
      [IntentType.GOVERNMENT_SCHEME_QUERY]:
        'Ayushman Bharat PM-JAY benefits eligibility covered hospital services',
      [IntentType.TELECONSULTATION_QUERY]:
        'talk to a doctor online teleconsultation service',
      [IntentType.FACILITY_QUERY]: location.district
        ? `PM-JAY empanelled hospitals in ${location.district}`
        : 'PM-JAY empanelled hospital facility',
      [IntentType.LAB_RESULT_QUERY]: 'HbA1c meaning average blood sugar',
      [IntentType.MEDICATION_QUERY]: 'medicine medication information',
      [IntentType.REFERRAL_QUERY]: 'clinical referral pathway hospital referral',
    };

    return {
      query: byIntent[intent] || patientQuery,
      ...location,
      normalized: byIntent[intent] !== undefined,
    };
  }

  private extractLocation(lower: string): Pick<NormalizedKnowledgeQuery, 'district' | 'state'> {
    if (/west\s+delhi|पश्चिम\s+दिल्ली/.test(lower)) {
      return { district: 'West Delhi', state: 'Delhi' };
    }
    if (/new\s+delhi|नई\s+दिल्ली/.test(lower)) {
      return { district: 'New Delhi', state: 'Delhi' };
    }
    return {};
  }
}
