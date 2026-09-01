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
  /** Canonical text for history, TTS, and plain-text patient consumers. */
  patientFacingText(content: PatientResponseContent): string {
    const parts = [content.summary];
    for (const section of content.sections || []) {
      const sectionParts = [section.title, section.body, ...(section.bullets || []).map((bullet) => `• ${bullet}`)]
        .filter((value): value is string => Boolean(value?.trim()));
      if (sectionParts.length) parts.push(sectionParts.join('\n'));
    }
    for (const card of content.cards || []) {
      const cardParts = [card.title, card.value, card.subtitle]
        .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
      if (cardParts.length) parts.push(cardParts.join(': '));
    }
    return parts.join('\n\n');
  }

  normalizeGeneratedContent(
    generated: unknown,
  ): PatientResponseContent | null {
    if (!generated || typeof generated !== 'object') return null;
    const candidate = generated as Record<string, unknown>;
    const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
    // A normal patient reply must be concise, but the SafetyGate owns emergency output.
    if (!summary || this.wordCount(summary) > 120 || this.containsInternalRetrievalMaterial(summary)) return null;

    const sections = Array.isArray(candidate.sections)
      ? candidate.sections
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
          .slice(0, 3)
          .map((s) => ({
            title: this.safePatientText(s.title),
            body: this.safePatientText(s.body),
            bullets: Array.isArray(s.bullets)
              ? s.bullets.map((b) => this.safePatientText(b)).filter((b): b is string => Boolean(b)).slice(0, 4)
              : undefined,
          }))
      : undefined;
    const cards = Array.isArray(candidate.cards)
      ? candidate.cards
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .slice(0, 5)
          .map((c) => ({
            title: this.safePatientText(c.title),
            value: this.safePatientText(c.value),
            subtitle: this.safePatientText(c.subtitle),
          }))
      : undefined;
    const actions = Array.isArray(candidate.actions)
      ? candidate.actions
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof a.label === 'string' && typeof a.action === 'string')
          .slice(0, 2)
          .map((a) => ({ label: this.safePatientText(a.label) || '', action: this.safePatientText(a.action) || '' }))
          .filter((a) => Boolean(a.label && a.action))
      : undefined;

    return { summary, sections, cards, actions };
  }

  /** Enforces semantic response completeness, not question-specific templates. */
  meetsResponseRequirements(content: PatientResponseContent, requirements: string[]): boolean {
    if (requirements.includes('GROUNDED_GUIDANCE')) {
      const bulletCount = (content.sections || []).reduce((count, section) => count + (section.bullets?.length || 0), 0);
      if (bulletCount < 2) return false;
    }
    if (requirements.includes('ALL_RECORD_ITEMS') && !(content.cards?.length || content.sections?.length)) return false;
    if (requirements.includes('CARE_PLAN_ITEMS') && !(content.sections?.length || content.cards?.length)) return false;
    return true;
  }

  private wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  private containsInternalRetrievalMaterial(text: string): boolean {
    return /(?:^|\n)\s*(?:title|source|domain|content)\s*:/i.test(text)
      || /\b[\w.-]+\.(?:pdf|docx|txt|md|csv)\b/i.test(text)
      || /\[(?:knowledge source|authorized knowledge source|deterministic scheme facts)\]/i.test(text);
  }

  private safePatientText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    return text && !this.containsInternalRetrievalMaterial(text) ? text : undefined;
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
    } = options;

    const formattedContent: Record<string, unknown> = { ...content };
    // Retrieval provenance stays in audit/evaluation services. The patient API
    // exposes only the standardized patient response and allowed UI structures.
    for (const internalField of [
      'knowledge_sources', 'scheme_results', 'matchedChunks', 'matched_chunks',
      'retrievalTrace', 'retrieval_trace', 'formattedKnowledgePrompt',
      'raw_content', 'rawContent', 'metadata', 'sources', 'documentId',
      'sourceDocumentId', 'embedding',
    ]) {
      delete formattedContent[internalField];
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
        // Medication cards are derived only from authorized ClinicalContext,
        // never from Gemini's optional cards.
        formattedContent['cards'] = clinicalContext.medications.slice(0, 5).map(
          (m) => ({
            title: m.medicationName,
            value: m.dosage || undefined,
            subtitle: [m.frequency, m.route].filter(Boolean).join(' · ') || undefined,
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
        // The semantic classifier selects the record category. This shared
        // formatter never routes individual lab questions by keyword rules.
        const requestedLabs = clinicalContext.labResults;
        formattedContent['lab_results'] = requestedLabs.slice(0, 3).map(
          (l) => ({
            test_name: l.testName,
            value: l.value,
            unit: l.unit,
            reference_range: l.referenceRange,
            observation_date: l.observationDate,
            interpretation: l.interpretationProvenance === 'GOVERNED' ? l.interpretation : null,
          }),
        );
        // Lab cards are likewise derived only from authorized ClinicalContext.
        formattedContent['cards'] = requestedLabs.slice(0, 3).map((l) => ({
          title: l.testName,
          value: [l.value, l.unit].filter(Boolean).join(' '),
          subtitle: l.interpretationProvenance === 'GOVERNED'
            ? l.interpretation || l.referenceRange || undefined
            : l.referenceRange || undefined,
        }));
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

    // Generate canonical plain text after ClinicalContext cards have been
    // attached, so TTS/history consumers receive the same authorized details
    // that the visual patient UI renders.
    const summary = typeof formattedContent['summary'] === 'string'
      ? formattedContent['summary']
      : undefined;
    if (summary) {
      formattedContent['summary'] = summary;
      const structured = formattedContent as unknown as PatientResponseContent;
      formattedContent['patient_text'] = this.patientFacingText(structured);
      formattedContent[options.language || 'en'] = formattedContent['patient_text'];
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
