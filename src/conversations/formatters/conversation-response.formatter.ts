import { Injectable } from '@nestjs/common';
import { ClinicalContext } from '../../abdm/models/clinical-context.models';

export interface FormattedPatientResponse {
  response_type: string;
  content: Record<string, unknown>;
  intent: string | null;
  selected_agent: string | null;
  safety_status: string;
}

@Injectable()
export class ConversationResponseFormatter {
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
  }): FormattedPatientResponse {
    const {
      responseType,
      content,
      intent,
      selectedAgent,
      safetyStatus,
      clinicalContext,
    } = options;

    const formattedContent: Record<string, unknown> = { ...content };

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
      }

      if (
        (intent?.includes('LAB') ||
          intent === 'LAB_RESULT_QUERY' ||
          intent === 'LAB_REPORT_QUERY') &&
        clinicalContext.labResults &&
        clinicalContext.labResults.length > 0
      ) {
        formattedContent['lab_results'] = clinicalContext.labResults.map(
          (l) => ({
            test_name: l.testName,
            value: l.value,
            unit: l.unit,
            reference_range: l.referenceRange,
            observation_date: l.observationDate,
            interpretation: l.interpretation,
          }),
        );
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
