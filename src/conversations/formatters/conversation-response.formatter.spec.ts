import { ConversationResponseFormatter } from './conversation-response.formatter';

describe('patient response formatting', () => {
  const formatter = new ConversationResponseFormatter();

  it('permits a simple answer with no sections and removes exact repeats', () => {
    const simple = formatter.normalizeGeneratedContent({ summary: 'आयुष्मान भारत योजना पात्र परिवारों की मदद करती है।', sections: [] });
    expect(simple?.sections).toEqual([]);
    const repeated = formatter.normalizeGeneratedContent({ summary: 'पात्रता पहले जाँचें।', sections: [
      { title: 'पात्रता', body: 'पात्रता पहले जाँचें।', bullets: ['पात्रता पहले जाँचें।', 'सरकारी सूची देखें।', 'सरकारी सूची देखें।'] },
    ] });
    expect(repeated?.sections).toEqual([{ title: 'पात्रता', body: undefined, bullets: ['सरकारी सूची देखें।'] }]);
  });

  it('does not expose Hindi as an English translation', () => {
    const hindi = 'अपनी रिपोर्ट डॉक्टर को दिखाएँ।';
    const formatted = formatter.formatResponse({ responseType: 'text', intent: 'REPORT_EDUCATION',
      selectedAgent: 'report-reader', safetyStatus: 'SAFE', content: { summary: hindi, hi: hindi, en: hindi } });
    expect(formatted.content.hi).toBe(hindi);
    expect(formatted.content.en).toBeUndefined();
    expect(formatted.content.summary).toBe(hindi);
  });

  it('replaces bureaucratic acronyms like EHCP and preserves spoken_summary', () => {
    const normalized = formatter.normalizeGeneratedContent({
      summary: 'आप अधिकृत अस्पतालों (EHCP) में इलाज करा सकते हैं।',
      spoken_summary: 'आप सूचीबद्ध अस्पताल में जानकारी ले सकते हैं।',
      sections: [{ bullets: ['नज़दीकी EHCP पर PMAM से मिलें।'] }],
    });
    expect(normalized?.summary).toBe('आप अधिकृत अस्पतालों में इलाज करा सकते हैं।');
    expect(normalized?.spoken_summary).toBe('आप सूचीबद्ध अस्पताल में जानकारी ले सकते हैं।');
    expect(normalized?.sections?.[0]?.bullets?.[0]).toBe('नज़दीकी सूचीबद्ध अस्पताल पर आयुष्मान मित्र से मिलें।');
  });
});
