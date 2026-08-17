import { ClinicalContext } from '../../abdm/models/clinical-context.models';

export interface MinimizedAiContext {
  intent: string;
  language: string;
  medications?: Array<{
    name: string;
    dosage: string | null;
    frequency: string | null;
    status: string;
  }>;
  prescriptions?: Array<{
    name: string;
    date: string | null;
    instructions: string | null;
    status: string;
  }>;
  diagnoses?: Array<{
    condition: string;
    status: string;
    onsetDate: string | null;
  }>;
  labResults?: Array<{
    test: string;
    value: string | null;
    unit: string | null;
    interpretation: string | null;
    date: string | null;
  }>;
  allergies?: Array<{
    allergen: string;
    reaction: string | null;
    severity: string | null;
    status: string;
  }>;
  unavailableCategories: string[];
  hasRecords: boolean;
}

export class ClinicalAiContextBuilder {
  /**
   * Transforms ClinicalContext into a minimized, PII-stripped model-facing representation.
   * NEVER exposes raw ABHA, patient identifiers, provider IDs, or raw sourceRef to the AI.
   */
  static buildMinimizedContext(
    context: ClinicalContext | null | undefined,
    language = 'hi',
  ): MinimizedAiContext {
    if (!context) {
      return {
        intent: 'UNKNOWN',
        language,
        unavailableCategories: [],
        hasRecords: false,
      };
    }

    const minContext: MinimizedAiContext = {
      intent: context.intent,
      language,
      unavailableCategories: context.unavailableCategories || [],
      hasRecords: false,
    };

    // 1. Medications
    if (context.medications && context.medications.length > 0) {
      minContext.medications = context.medications.map((m) => ({
        name: m.medicationName,
        dosage: m.dosage,
        frequency: m.frequency,
        status: m.status,
      }));
      minContext.hasRecords = true;
    }

    // 2. Prescriptions
    if (context.prescriptions && context.prescriptions.length > 0) {
      minContext.prescriptions = context.prescriptions.map((p) => ({
        name: p.medicationName,
        date: p.prescriptionDate
          ? p.prescriptionDate.toISOString().split('T')[0]
          : null,
        instructions: p.instructions,
        status: p.status,
      }));
      minContext.hasRecords = true;
    }

    // 3. Diagnoses
    if (context.diagnoses && context.diagnoses.length > 0) {
      minContext.diagnoses = context.diagnoses.map((d) => ({
        condition: d.conditionName,
        status: d.status,
        onsetDate: d.onsetDate ? d.onsetDate.toISOString().split('T')[0] : null,
      }));
      minContext.hasRecords = true;
    }

    // 4. Lab Results
    if (context.labResults && context.labResults.length > 0) {
      minContext.labResults = context.labResults.map((l) => ({
        test: l.testName,
        value: l.value,
        unit: l.unit,
        interpretation: l.interpretation,
        date: l.observationDate
          ? l.observationDate.toISOString().split('T')[0]
          : null,
      }));
      minContext.hasRecords = true;
    }

    // 5. Allergies
    if (context.allergies && context.allergies.length > 0) {
      minContext.allergies = context.allergies.map((a) => ({
        allergen: a.allergen,
        reaction: a.reactionType,
        severity: a.severity,
        status: a.status,
      }));
      minContext.hasRecords = true;
    }

    return minContext;
  }

  /**
   * Formats the minimized context into a system prompt string for Gemini/LLM.
   */
  static formatPromptContext(minContext: MinimizedAiContext): string {
    return `[AUTHORIZED CLINICAL CONTEXT]
Intent: ${minContext.intent}
Language: ${minContext.language}
Records Available: ${minContext.hasRecords ? 'YES' : 'NO (Empty or Unavailable)'}
Unavailable Categories: ${minContext.unavailableCategories.join(', ') || 'None'}
Context Payload: ${JSON.stringify(minContext, null, 2)}`;
  }
}
