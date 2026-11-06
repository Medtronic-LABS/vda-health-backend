import { IntentType } from '../../ai/intents/intent.types';
import { KnowledgeQueryNormalizerService } from './knowledge-query-normalizer.service';

describe('shared retrieval query normalization', () => {
  const normalizer = new KnowledgeQueryNormalizerService();

  it('uses one canonical scheme query for equivalent Hindi, Hinglish, and English questions', () => {
    const queries = [
      normalizer.normalize(
        'Ayushman Bharat kya hai?',
        'hi-Latn',
        IntentType.GOVERNMENT_SCHEME_QUERY,
      ),
      normalizer.normalize(
        'आयुष्मान भारत क्या है?',
        'hi',
        IntentType.GOVERNMENT_SCHEME_QUERY,
      ),
      normalizer.normalize(
        'What is Ayushman Bharat?',
        'en',
        IntentType.GOVERNMENT_SCHEME_QUERY,
      ),
      normalizer.normalize(
        'What is ABPMJ?',
        'en',
        IntentType.GOVERNMENT_SCHEME_QUERY,
      ),
      normalizer.normalize(
        'क्या आयुष्मान में 5 लाख तक का इलाज मुफ्त है?',
        'hi',
        IntentType.GOVERNMENT_SCHEME_QUERY,
      ),
    ];
    expect(new Set(queries.map(({ query }) => query)).size).toBe(1);
    expect(queries.every(({ normalized }) => normalized)).toBe(true);
  });

  it('normalizes Hindi scheme application questions even when they contain negation ("नहीं")', () => {
    const res = normalizer.normalize(
      'मेरे पास आयुष्मान कार्ड नहीं है तो कैसे बनवाएं?',
      'hi',
      IntentType.GOVERNMENT_SCHEME_QUERY,
    );
    expect(res.normalized).toBe(true);
    expect(res.query).toContain('AB PM-JAY');
    expect(res.category).toBe('pmjay_operations');
  });

  it.each([
    ['Ayushman card kaise banwayein?', 'hi-Latn'],
    ['ayushman card kaise bane', 'hi-Latn'],
    ['पीएमजे के लिए कैसे अप्लाई कर सकता हूँ?', 'hi'],
    ['आयुष्मान कार्ड कैसे बनवाएँ?', 'hi'],
    ['How can I apply for an Ayushman card?', 'en'],
  ])('searches the card application steps for "%s"', (question, language) => {
    const res = normalizer.normalize(
      question,
      language,
      IntentType.GOVERNMENT_SCHEME_QUERY,
    );
    expect(res.query).toContain('Beneficiary Identification System');
    expect(res.category).toBe('pmjay_operations');
  });

  it('does not read Jan Dhan (पीएमजेडीवाई) as PM-JAY', () => {
    const res = normalizer.normalize(
      'पीएमजेडीवाई खाता कैसे खोलें?',
      'hi',
      IntentType.GOVERNMENT_SCHEME_QUERY,
    );
    expect(res.category).toBeUndefined();
    expect(res.query).not.toContain('Beneficiary Identification System');
  });

  it('does not erase medicine names, report values, negation, or emergency wording', () => {
    const cases: Array<[string, string, IntentType]> = [
      ['Telma 40 mg kab leni hai?', 'hi-Latn', IntentType.MEDICATION_QUERY],
      [
        'Meri report mein HbA1c 6.2% hai',
        'hi-Latn',
        IntentType.LAB_RESULT_QUERY,
      ],
      ['मुझे सीने में दर्द नहीं है', 'hi', IntentType.GENERAL_HEALTH_QUERY],
      ['I have severe chest pain', 'en', IntentType.GENERAL_HEALTH_QUERY],
    ];
    for (const [question, language, intent] of cases) {
      expect(normalizer.normalize(question, language, intent).query).toBe(
        question,
      );
    }
  });
});
