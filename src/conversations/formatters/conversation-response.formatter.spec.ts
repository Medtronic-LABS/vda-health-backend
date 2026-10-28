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
});
