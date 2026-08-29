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
    explicitState?: string,
  ): NormalizedKnowledgeQuery {
    const lower = patientQuery.toLowerCase();
    const location = this.extractLocation(lower);
    const effectiveState = location.state || explicitState;
    const needsNormalization = language === 'hi' || language === 'hi-Latn' || /himcare|himachal/i.test(lower);

    if (!needsNormalization && !location.state && !location.district) {
      return { query: patientQuery, state: effectiveState, district: location.district, normalized: false };
    }

    const schemeQuery = this.normalizeSchemeQuery(lower, effectiveState);
    const byIntent: Partial<Record<IntentType, string>> = {
      [IntentType.ADHERENCE_QUERY]:
        'I forget to take my medicines regularly medication adherence',
      [IntentType.GOVERNMENT_SCHEME_QUERY]: schemeQuery,
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
      state: effectiveState,
      district: location.district,
      normalized: byIntent[intent] !== undefined,
    };
  }

  private extractLocation(lower: string): Pick<NormalizedKnowledgeQuery, 'district' | 'state'> {
    let district: string | undefined;
    let state: string | undefined;

    if (/mandi|मंडी/.test(lower)) {
      district = 'Mandi';
      state = 'HIMACHAL_PRADESH';
    } else if (/kangra|कांगड़ा|कांगरा/.test(lower)) {
      district = 'Kangra';
      state = 'HIMACHAL_PRADESH';
    } else if (/solan|सोलन/.test(lower)) {
      district = 'Solan';
      state = 'HIMACHAL_PRADESH';
    } else if (/una|ऊना/.test(lower)) {
      district = 'Una';
      state = 'HIMACHAL_PRADESH';
    } else if (/shimla|शिमला/.test(lower)) {
      district = 'Shimla';
      state = 'HIMACHAL_PRADESH';
    } else if (/kullu|कुल्लू/.test(lower)) {
      district = 'Kullu';
      state = 'HIMACHAL_PRADESH';
    } else if (/hamirpur|हमीरपुर/.test(lower)) {
      district = 'Hamirpur';
      state = 'HIMACHAL_PRADESH';
    } else if (/bilaspur|बिलासपुर/.test(lower)) {
      district = 'Bilaspur';
      state = 'HIMACHAL_PRADESH';
    } else if (/sirmaur|सिरमौर/.test(lower)) {
      district = 'Sirmaur';
      state = 'HIMACHAL_PRADESH';
    } else if (/chamba|चंबा/.test(lower)) {
      district = 'Chamba';
      state = 'HIMACHAL_PRADESH';
    } else if (/gurugram|gurgaon|गुरुग्राम|गुड़गांव/.test(lower)) {
      district = 'GURUGRAM';
      state = 'HARYANA';
    } else if (/west\s+delhi|पश्चिम\s+दिल्ली/.test(lower)) {
      district = 'West Delhi';
      state = 'Delhi';
    } else if (/new\s+delhi|नई\s+दिल्ली/.test(lower)) {
      district = 'New Delhi';
      state = 'Delhi';
    }

    if (!state) {
      if (/himachal|हिमाचल/.test(lower)) {
        state = 'HIMACHAL_PRADESH';
      } else if (/haryana|हरियाणा/.test(lower)) {
        state = 'HARYANA';
      } else if (/delhi|दिल्ली/.test(lower)) {
        state = 'Delhi';
      }
    }

    return { ...(district ? { district } : {}), ...(state ? { state } : {}) };
  }

  /**
   * Converts common Hindi/Hinglish scheme terms into a retrieval-only English
   * representation.  It does not generate an answer or make an eligibility
   * determination; it only makes the existing English governed corpus
   * searchable by the configured local embedding model.
   */
  private normalizeSchemeQuery(lower: string, state?: string): string {
    if (/himcare|हिमकेयर/.test(lower)) {
      if (/document|दस्तावेज/.test(lower)) {
        return 'HIMCARE required documents BPL certificate MNREGA job card disability certificate employment category certificate';
      }
      if (/eligible|eligibility|पात्र/.test(lower)) {
        return 'HIMCARE eligibility criteria required documents official verification';
      }
      return 'HIMCARE benefits coverage eligibility enrollment';
    }

    if (/ayushman|pm-jay|pmjay|आयुष्मान/.test(lower)) {
      if (/document|दस्तावेज/.test(lower)) {
        return 'Ayushman Bharat PM-JAY eligibility required documents beneficiary identification';
      }
      if (/eligible|eligibility|पात्र/.test(lower)) {
        return 'Ayushman Bharat PM-JAY eligibility criteria required documents official verification';
      }
      return 'Ayushman Bharat PM-JAY benefits coverage cashless hospitalization';
    }

    // Generic state scheme query (e.g. "mere state me konsi yojnay hai", "मेरे राज्य में कौन सी योजनाएं हैं")
    if (state === 'HIMACHAL_PRADESH' || /himachal|हिमाचल/.test(lower)) {
      return 'Himachal Pradesh state healthcare schemes HIMCARE Ayushman Bharat PM-JAY coverage benefits eligibility';
    }

    if (/document|दस्तावेज/.test(lower)) {
      return 'Ayushman Bharat PM-JAY eligibility required documents beneficiary identification';
    }
    if (/eligible|eligibility|पात्र/.test(lower)) {
      return 'Ayushman Bharat PM-JAY eligibility criteria required documents official verification';
    }

    return 'Government healthcare schemes Ayushman Bharat PM-JAY HIMCARE state health coverage benefits eligibility';
  }
}
