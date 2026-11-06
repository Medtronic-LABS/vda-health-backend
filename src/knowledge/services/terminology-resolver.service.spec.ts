import { TerminologyResolverService } from './terminology-resolver.service';
import { ModularPromptBuilder } from '../../ai/orchestration/modular-prompt.builder';
import { IntentType } from '../../ai/intents/intent.types';

describe('Stage 1 TerminologyResolverService & Stage 3 ModularPromptBuilder', () => {
  const resolver = new TerminologyResolverService();

  it.each([
    ['What is Ayushman Bharat?', 'PM-JAY'],
    ['Tell me about ABPMJ', 'PM-JAY'],
    ['AB-PMJAY kya hai?', 'PM-JAY'],
    ['आयुष्मान भारत योजना क्या है?', 'PM-JAY'],
    ['5 lakh wala card kaise banega?', 'PM-JAY'],
    ['HIMCARE card eligibility', 'HIMCARE'],
    ['हिमकेयर योजना के लाभ', 'HIMCARE'],
    ['Jan Aushadhi kendra medicines', 'PMBJP'],
  ] as const)(
    'resolves "%s" to canonical scheme "%s"',
    (query, expectedScheme) => {
      expect(resolver.resolveCanonicalScheme(query)).toBe(expectedScheme);
      expect(resolver.isDirectSchemeQuery(query)).toBe(true);
    },
  );

  it('prevents false SCHEME_UNKNOWN on direct canonical scheme queries', () => {
    expect(
      resolver.resolveSchemeInformationType(
        'What is Ayushman Bharat?',
        'SCHEME_UNKNOWN',
      ),
    ).toBe('SCHEME_OVERVIEW');
    expect(
      resolver.resolveSchemeInformationType('ABPMJ kya hai?', undefined),
    ).toBe('SCHEME_OVERVIEW');
    expect(
      resolver.resolveSchemeInformationType(
        'आयुष्मान कार्ड के लिए कौन से दस्तावेज चाहिए?',
        'SCHEME_UNKNOWN',
      ),
    ).toBe('SCHEME_DOCUMENTS');
    expect(
      resolver.resolveSchemeInformationType(
        'आयुष्मान कार्ड कैसे बनवाएं?',
        'SCHEME_UNKNOWN',
      ),
    ).toBe('SCHEME_APPLICATION');
  });

  it('replaces bureaucratic acronyms like EHCP and PMAM with patient-friendly terms', () => {
    expect(
      resolver.sanitizeBureaucraticTerms(
        'आप अधिकृत सरकारी और प्राइवेट अस्पतालों (EHCP) में PMAM से मिल सकते हैं।',
        'hi',
      ),
    ).toBe(
      'आप अधिकृत सरकारी और प्राइवेट अस्पतालों में आरोग्य मित्र से मिल सकते हैं।',
    );
    expect(
      resolver.sanitizeBureaucraticTerms(
        'Visit Empanelled Health Care Providers (EHCP) or any EHCP helpdesk.',
        'en',
      ),
    ).toBe('Visit approved hospitals or any approved hospitals helpdesk.');
  });

  it('builds domain-scoped prompts without forcing a 30-word limit on visual answers', () => {
    const schemePrompt = ModularPromptBuilder.buildSystemPrompt({
      language: 'hi',
      intent: IntentType.GOVERNMENT_SCHEME_QUERY,
      schemeInformationType: 'SCHEME_OVERVIEW',
    });
    // Short answers, read aloud as shown, in a woman ASHA's simple spoken Hindi.
    expect(schemePrompt).toContain('under 60 words');
    expect(schemePrompt).toContain('at most 3');
    expect(schemePrompt).toContain('feminine forms');
    expect(schemePrompt).toContain('simple spoken Hindi');
    expect(schemePrompt).not.toContain('spoken_summary');
    expect(schemePrompt).toContain('Scheme Information (SCHEME_OVERVIEW)');
    expect(schemePrompt).not.toContain(
      'Uploaded Prescription Source Isolation',
    );
  });
});
