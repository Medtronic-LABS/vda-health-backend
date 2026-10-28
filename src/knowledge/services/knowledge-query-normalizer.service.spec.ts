import { IntentType } from '../../ai/intents/intent.types';
import { KnowledgeQueryNormalizerService } from './knowledge-query-normalizer.service';

describe('shared retrieval query normalization', () => {
  const normalizer = new KnowledgeQueryNormalizerService();

  it('uses one canonical scheme query for equivalent Hindi, Hinglish, and English questions', () => {
    const queries = [
      normalizer.normalize('Ayushman Bharat kya hai?', 'hi-Latn', IntentType.GOVERNMENT_SCHEME_QUERY),
      normalizer.normalize('आयुष्मान भारत क्या है?', 'hi', IntentType.GOVERNMENT_SCHEME_QUERY),
      normalizer.normalize('What is Ayushman Bharat?', 'en', IntentType.GOVERNMENT_SCHEME_QUERY),
    ];
    expect(new Set(queries.map(({ query }) => query)).size).toBe(1);
    expect(queries.every(({ normalized }) => normalized)).toBe(true);
  });

  it('does not erase medicine names, report values, negation, or emergency wording', () => {
    const cases: Array<[string, string, IntentType]> = [
      ['Telma 40 mg kab leni hai?', 'hi-Latn', IntentType.MEDICATION_QUERY],
      ['Meri report mein HbA1c 6.2% hai', 'hi-Latn', IntentType.LAB_RESULT_QUERY],
      ['मुझे सीने में दर्द नहीं है', 'hi', IntentType.GENERAL_HEALTH_QUERY],
      ['I have severe chest pain', 'en', IntentType.GENERAL_HEALTH_QUERY],
    ];
    for (const [question, language, intent] of cases) {
      expect(normalizer.normalize(question, language, intent).query).toBe(question);
    }
  });
});
