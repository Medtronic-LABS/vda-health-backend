import { sanitizeForSpeech } from './sanitize-for-speech';

describe('sanitizeForSpeech', () => {
  it('speaks scheme acronyms naturally without raw links or markdown', () => {
    const spoken = sanitizeForSpeech('**PM-JAY**\n- CSC पर पूछें।\n- https://beneficiary.nha.gov.in देखें।', 'hi-IN');
    expect(spoken).toContain('आयुष्मान भारत योजना');
    expect(spoken).toContain('कॉमन सर्विस सेंटर');
    expect(spoken).toContain('वेबसाइट की जानकारी स्क्रीन पर देखें');
    expect(spoken).not.toMatch(/https?:|\*\*|^- /u);
  });

  it('preserves medical values, units, medicine strengths, and urgent instructions', () => {
    const spoken = sanitizeForSpeech('HbA1c 6.2%. Glucose 245 mg/dL. Telma 40 mg. तुरंत अस्पताल जाएँ। दवा बंद न करें।', 'hi-IN');
    expect(spoken).toContain('एच बी ए वन सी 6.2%');
    expect(spoken).toContain('245 mg/dL');
    expect(spoken).toContain('Telma 40 mg');
    expect(spoken).toContain('तुरंत अस्पताल जाएँ');
    expect(spoken).toContain('दवा बंद न करें');
  });

  it('keeps meaningful parentheses and removes only adjacent duplicate sentences', () => {
    const spoken = sanitizeForSpeech('Metformin (500 mg) रात में लें। Metformin (500 mg) रात में लें। डॉक्टर से पूछें।', 'hi-IN');
    expect(spoken).toBe('Metformin (500 mg) रात में लें। डॉक्टर से पूछें।');
  });
});
