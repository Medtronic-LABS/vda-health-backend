import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ConversationResponseFormatter,
  explicitlyRequestedLanguage,
} from './conversation-response.formatter';

// Fixed patient replies speak as a woman ASHA Didi, in the profile language,
// and never hide needed information inside brackets (voice skips brackets).
describe('fixed patient replies keep the ASHA voice', () => {
  const src = join(__dirname, '..', '..');
  const files = [
    'ai/orchestration/ai-orchestrator.service.ts',
    'ai/education/asha-education.service.ts',
    'safety/services/development-safety-gate.service.ts',
    'reports/medical-report.service.ts',
    ...readdirSync(join(src, 'agents/domain')).map(
      (name) => `agents/domain/${name}`,
    ),
    ...readdirSync(join(src, 'ai/agents')).map((name) => `ai/agents/${name}`),
  ].filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));

  it.each(files)(
    '%s has no masculine first person, Roman Hindi reply, or bracketed emergency number',
    (file) => {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text).not.toMatch(
        /(?:सकता|पाया)\s*(?:हूँ|हूं)|समझ नहीं पाया|नहीं (?:कर|दे|बता) सकता[।']/u,
      );
      expect(text).not.toMatch(/'(?:Abhi|Aapki|Aapke|Yadi aap|Agar aap)\s/u);
      expect(text).not.toMatch(/\([^)]*\b(?:108|112)\b[^)]*\)/u);
    },
  );
});

describe('patient response formatting', () => {
  const formatter = new ConversationResponseFormatter();

  it('permits a simple answer with no sections and removes exact repeats', () => {
    const simple = formatter.normalizeGeneratedContent({
      summary: 'आयुष्मान भारत योजना पात्र परिवारों की मदद करती है।',
      sections: [],
    });
    expect(simple?.sections).toEqual([]);
    const repeated = formatter.normalizeGeneratedContent({
      summary: 'पात्रता पहले जाँचें।',
      sections: [
        {
          title: 'पात्रता',
          body: 'पात्रता पहले जाँचें।',
          bullets: [
            'पात्रता पहले जाँचें।',
            'सरकारी सूची देखें।',
            'सरकारी सूची देखें।',
          ],
        },
      ],
    });
    expect(repeated?.sections).toEqual([
      { title: 'पात्रता', body: undefined, bullets: ['सरकारी सूची देखें।'] },
    ]);
  });

  it('does not expose Hindi as an English translation', () => {
    const hindi = 'अपनी रिपोर्ट डॉक्टर को दिखाएँ।';
    const formatted = formatter.formatResponse({
      responseType: 'text',
      intent: 'REPORT_EDUCATION',
      selectedAgent: 'report-reader',
      safetyStatus: 'SAFE',
      content: { summary: hindi, hi: hindi, en: hindi },
    });
    expect(formatted.content.hi).toBe(hindi);
    expect(formatted.content.en).toBeUndefined();
    expect(formatted.content.summary).toBe(hindi);
  });

  it('replaces bureaucratic acronyms like EHCP', () => {
    const normalized = formatter.normalizeGeneratedContent({
      summary: 'आप अधिकृत अस्पतालों (EHCP) में इलाज करा सकते हैं।',
      sections: [{ bullets: ['नज़दीकी EHCP पर PMAM से मिलें।'] }],
    });
    expect(normalized?.summary).toBe(
      'आप अधिकृत अस्पतालों में इलाज करा सकते हैं।',
    );
    expect(normalized?.sections?.[0]?.bullets?.[0]).toBe(
      'नज़दीकी योजना से जुड़े अस्पताल पर आरोग्य मित्र से मिलें।',
    );
  });

  it('keeps generated answers short: at most three points', () => {
    const normalized = formatter.normalizeGeneratedContent({
      summary: 'बीपी कंट्रोल के लिए:',
      sections: [
        {
          bullets: [
            'नमक कम खाएँ।',
            'रोज़ चलें।',
            'तंबाकू छोड़ें।',
            'वज़न ठीक रखें।',
          ],
        },
      ],
    });
    expect(normalized?.sections?.[0]?.bullets).toHaveLength(3);
  });

  it('keeps at most three points in total across sections', () => {
    const normalized = formatter.normalizeGeneratedContent({
      summary: 'आयुष्मान कार्ड से मदद मिलती है।',
      sections: [
        { title: 'फ़ायदे', bullets: ['5 लाख तक इलाज।', 'भर्ती का खर्च।'] },
        {
          title: 'कैसे',
          bullets: ['आरोग्य मित्र से मिलें।', 'आधार साथ ले जाएँ।'],
        },
      ],
    });
    const bullets = (normalized?.sections || []).flatMap(
      (section) => section.bullets || [],
    );
    expect(bullets).toEqual([
      '5 लाख तक इलाज।',
      'भर्ती का खर्च।',
      'आरोग्य मित्र से मिलें।',
    ]);
  });

  describe('voice follows the screen', () => {
    const format = (
      content: Record<string, unknown>,
      language = 'hi',
      inputText?: string,
    ) =>
      formatter.formatResponse({
        responseType: 'text',
        intent: null,
        selectedAgent: null,
        safetyStatus: 'SAFE',
        content,
        language,
        inputText,
      }).content;

    it('speaks the summary and points, without headings or bracketed words', () => {
      const content = format({
        summary: 'आपकी पर्ची की जाँच कम्युनिटी हेल्थ ऑफिसर (CHO) कर रहे हैं',
        spoken_summary: 'AI ka alag jawab',
        sections: [
          {
            title: 'अगले कदम',
            bullets: [
              '• पुरानी दवाइयाँ लेते रहें।',
              'जाँच पूरी होने पर फ़ोन पर संदेश आएगा।',
            ],
          },
        ],
      });
      expect(content.spoken_summary).toBe(
        'आपकी पर्ची की जाँच कम्युनिटी हेल्थ ऑफिसर कर रहे हैं। पुरानी दवाइयाँ लेते रहें। जाँच पूरी होने पर फ़ोन पर संदेश आएगा।',
      );
    });

    it('reads facility names but not phone or label lines', () => {
      const content = format({
        summary: 'Faridabad में ये सरकारी अस्पताल हैं।',
        cards: [
          {
            title: 'B K Civil Hospital',
            value: 'Faridabad',
            subtitle: 'फ़ोन: 0129 222',
          },
        ],
      });
      expect(content.spoken_summary).toBe(
        'Faridabad में ये सरकारी अस्पताल हैं। B K Civil Hospital, Faridabad.',
      );
    });

    it('answers in the profile language and offers to switch when asked in another', () => {
      const english = format(
        { summary: 'नमक कम खाएँ।' },
        'hi',
        'How can I control my BP at home?',
      );
      expect(english.summary).toMatch(/^नमक कम खाएँ।/u);
      // Added to the summary, not as a section, so the app keeps showing card lists.
      expect(english.sections).toBeUndefined();
      expect(english.patient_text).toContain('अंग्रेज़ी');
      expect(english.spoken_summary).toContain('अंग्रेज़ी');
      // Replies pass through the formatter twice (orchestrator, then turn pipeline).
      const twice = format(english, 'hi', 'How can I control my BP at home?');
      expect(String(twice.summary).split('अंग्रेज़ी').length - 1).toBe(1);
      const hindi = format(
        { summary: 'Eat less salt.' },
        'en',
        'BP kaise control karein?',
      );
      expect(hindi.patient_text).toContain('Hindi');
    });

    it.each([
      ['hi', 'बीपी कैसे कंट्रोल करें?'],
      ['hi', 'BP kaise control karein?'],
      ['en', 'How can I control my BP at home?'],
      ['hi', 'MRI'],
    ])(
      'does not offer a switch for %s profile and question %s',
      (language, question) => {
        const content = format({ summary: 'ok' }, language, question);
        expect(content.patient_text).toBe('ok');
      },
    );
  });
});

describe('explicit language requests (clinical review)', () => {
  it.each([
    ['मुझे डायबिटीज के बारे में सिंपल हिंदी में समझाओ', 'hi'],
    ['Explain BP in simple Hindi', 'hi'],
    ['BP ke baare mein English mein batao', 'en'],
    ['Tell me in English', 'en'],
    ['What is diabetes?', null],
  ])('%s -> %s', (question, language) => {
    expect(explicitlyRequestedLanguage(question)).toBe(language);
  });

  it('drops the switch-language note when the patient asked for the language', () => {
    const formatted = new ConversationResponseFormatter().formatResponse({
      responseType: 'text',
      content: { summary: 'डायबिटीज में शुगर बढ़ जाती है।' },
      intent: null,
      selectedAgent: null,
      safetyStatus: 'SAFE',
      language: 'en',
      inputText: 'मुझे डायबिटीज के बारे में सिंपल हिंदी में समझाओ',
    });
    expect(JSON.stringify(formatted)).not.toContain('Profile');
  });
});
