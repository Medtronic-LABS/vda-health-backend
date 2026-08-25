import { Injectable } from '@nestjs/common';
import { ClinicalContext } from '../../abdm/models/clinical-context.models';

export interface FormattedPatientResponse {
  response_type: string;
  content: Record<string, unknown>;
  intent: string | null;
  selected_agent: string | null;
  safety_status: string;
}

export interface PatientResponseContent {
  summary: string;
  sections?: Array<{ title?: string; body?: string; bullets?: string[] }>;
  cards?: Array<Record<string, unknown>>;
  actions?: Array<{ label: string; action: string }>;
}

@Injectable()
export class ConversationResponseFormatter {
  normalizeGeneratedContent(
    generated: unknown,
  ): PatientResponseContent | null {
    if (!generated || typeof generated !== 'object') return null;
    const candidate = generated as Record<string, unknown>;
    const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
    // A normal patient reply must be concise, but the SafetyGate owns emergency output.
    if (!summary || this.wordCount(summary) > 120) return null;

    const sections = Array.isArray(candidate.sections)
      ? candidate.sections
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
          .slice(0, 3)
          .map((s) => ({
            title: typeof s.title === 'string' ? s.title : undefined,
            body: typeof s.body === 'string' ? s.body : undefined,
            bullets: Array.isArray(s.bullets)
              ? s.bullets.filter((b): b is string => typeof b === 'string').slice(0, 4)
              : undefined,
          }))
      : undefined;
    const cards = Array.isArray(candidate.cards)
      ? candidate.cards.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object').slice(0, 5)
      : undefined;
    const actions = Array.isArray(candidate.actions)
      ? candidate.actions
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof a.label === 'string' && typeof a.action === 'string')
          .slice(0, 2)
          .map((a) => ({ label: String(a.label), action: String(a.action) }))
      : undefined;

    return { summary, sections, cards, actions };
  }

  private wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Formats AI turn results into structured patient-safe responses with clinical card metadata.
   */
  formatResponse(options: {
    responseType: string;
    content: Record<string, unknown>;
    intent: string | null;
    selectedAgent: string | null;
    safetyStatus: string;
    clinicalContext?: ClinicalContext | null;
    language?: string;
    inputText?: string;
  }): FormattedPatientResponse {
    const {
      responseType,
      content,
      intent,
      selectedAgent,
      safetyStatus,
      clinicalContext,
      inputText = '',
    } = options;

    const formattedContent: Record<string, unknown> = { ...content };

    // Gemini's governed response contract always renders through `summary`.
    // Retain the language-keyed text for API compatibility and TTS only.
    const summary = typeof formattedContent['summary'] === 'string'
      ? formattedContent['summary']
      : undefined;
    if (summary) {
      formattedContent['summary'] = summary;
      formattedContent[options.language || 'en'] = summary;
    }

    // Embed structured cards based on ClinicalContext when available
    if (clinicalContext) {
      if (
        (intent?.includes('MEDICATION') ||
          intent === 'MEDICATION_QUERY' ||
          intent === 'ADHERENCE_QUERY') &&
        clinicalContext.medications &&
        clinicalContext.medications.length > 0
      ) {
        formattedContent['medications'] = clinicalContext.medications.map(
          (m) => ({
            name: m.medicationName,
            dosage: m.dosage,
            frequency: m.frequency,
            status: m.status,
          }),
        );
        // Medication values must come from authorized ClinicalContext, not LLM cards.
        formattedContent['cards'] = [];
      }

      if (
        (intent?.includes('LAB') ||
          intent === 'LAB_RESULT_QUERY' ||
          intent === 'LAB_REPORT_QUERY') &&
        clinicalContext.labResults &&
        clinicalContext.labResults.length > 0
      ) {
        const lowerInput = inputText.toLowerCase();
        const requestedLabs = clinicalContext.labResults.filter((l) => {
          if (/hba1c|एचबीए1सी|एचबीए1सी/.test(lowerInput)) {
            return /hba1c/i.test(l.testName);
          }
          return true;
        });
        formattedContent['lab_results'] = requestedLabs.slice(0, 3).map(
          (l) => ({
            test_name: l.testName,
            value: l.value,
            unit: l.unit,
            reference_range: l.referenceRange,
            observation_date: l.observationDate,
            interpretation: l.interpretation,
          }),
        );
        // Lab values must come from authorized ClinicalContext, not LLM cards.
        formattedContent['cards'] = [];
      }

      if (
        (intent?.includes('DIAGNOSIS') || intent === 'DIAGNOSIS_QUERY') &&
        clinicalContext.diagnoses &&
        clinicalContext.diagnoses.length > 0
      ) {
        formattedContent['diagnoses'] = clinicalContext.diagnoses.map((d) => ({
          condition_name: d.conditionName,
          severity: d.severity,
          onset_date: d.onsetDate,
          status: d.status,
        }));
      }

      if (
        (intent?.includes('ALLERGY') || intent === 'ALLERGY_QUERY') &&
        clinicalContext.allergies &&
        clinicalContext.allergies.length > 0
      ) {
        formattedContent['allergies'] = clinicalContext.allergies.map((a) => ({
          allergen: a.allergen,
          reaction_type: a.reactionType,
          severity: a.severity,
          status: a.status,
        }));
      }
    }

    // Preserve existing card structures if already present in content
    const medVal = content['medications'];
    if (medVal !== undefined) {
      formattedContent['medications'] = medVal;
    }
    const labVal = content['lab_results'];
    if (labVal !== undefined) {
      formattedContent['lab_results'] = labVal;
    }
    const labResultsVal = content['labResults'];
    if (labResultsVal !== undefined) {
      formattedContent['lab_results'] = labResultsVal;
    }
    const diagVal = content['diagnoses'];
    if (diagVal !== undefined) {
      formattedContent['diagnoses'] = diagVal;
    }
    const allergyVal = content['allergies'];
    if (allergyVal !== undefined) {
      formattedContent['allergies'] = allergyVal;
    }

    // Ensure text explanation key exists in primary language and english
    const hiText = formattedContent['hi'];
    const enText = formattedContent['en'];
    if (hiText === undefined && typeof enText === 'string') {
      formattedContent['hi'] = enText;
    }
    if (enText === undefined && typeof hiText === 'string') {
      formattedContent['en'] = hiText;
    }

    return {
      response_type: responseType,
      content: formattedContent,
      intent,
      selected_agent: selectedAgent,
      safety_status: safetyStatus,
    };
  }
}
