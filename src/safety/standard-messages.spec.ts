import {
  asksToStopAllMedicines,
  EMERGENCY_MESSAGE,
  emergencyKind,
  emergencyMessage,
  medicineChangeMessage,
} from './standard-messages';

describe('standard medicine messages (clinical review)', () => {
  it.each([
    [
      'Should I increase my BP medicine?',
      'Only a doctor can decide to increase your medicine.',
    ],
    [
      'क्या मैं दवा बंद कर दूँ?',
      'दवा बंद करने का फ़ैसला सिर्फ़ डॉक्टर कर सकते हैं।',
    ],
    ['क्या दवा बढ़ा दूँ?', 'दवा बढ़ाने का फ़ैसला सिर्फ़ डॉक्टर कर सकते हैं।'],
  ])('names only the action asked about: %s', (question, expected) => {
    const message = medicineChangeMessage(question, /[ऀ-ॿ]/u.test(question));
    expect(message).toContain(expected);
    expect(message).toContain('CHO');
    expect(message).not.toContain('ANM');
  });

  it('lists every action when more than one is asked', () => {
    expect(
      medicineChangeMessage(
        'Should I stop one and start another medicine?',
        false,
      ),
    ).toBe(
      'Only a doctor can decide to increase, reduce, stop or start a medicine. Please talk to your doctor or CHO.',
    );
  });

  it.each([
    'मेरी सारी मेडिसिन बंद कर दो।',
    'Stop all my medicines.',
    'Meri sari medicines band kar do.',
  ])('treats "%s" as stop-all', (question) =>
    expect(asksToStopAllMedicines(question)).toBe(true),
  );

  it('does not treat stopping one medicine as stop-all', () => {
    expect(asksToStopAllMedicines('Should I stop Telma?')).toBe(false);
  });
});

describe('heart attack and stroke warning signs (clinical review round 3)', () => {
  it.each([
    ['मेरे सीने में दबाव है', 'HEART_ATTACK'],
    ['Chest mein bahut dard ho raha hai', 'HEART_ATTACK'],
    ['मुझे साँस लेने में तकलीफ हो रही है', 'HEART_ATTACK'],
    ['Heart attack ke symptoms kya hain?', 'HEART_ATTACK'],
    ['Dil ke daure ke lakshan batao', 'HEART_ATTACK'],
    ['Lakwa ke symptoms kya hain?', 'STROKE'],
    ['अचानक तेज सिरदर्द हो रहा है', 'STROKE'],
    ['Achanak chakkar aaya aur gir gaya', 'STROKE'],
    ['एक आँख से कम दिखाई दे रहा है', 'STROKE'],
    ['चेहरा टेढ़ा हो गया है और बोलने में दिक्कत है', 'STROKE'],
    ['Suddenly my left arm and leg feel numb on one side', 'STROKE'],
    ['Chest pain and slurred speech', 'OTHER'],
  ])('%s -> %s', (text, kind) => {
    expect(emergencyKind(text)).toBe(kind);
  });

  it.each([
    'मुझे उल्टी हो रही है',
    'Mere sir mein dard hai',
    'Kabhi kabhi chakkar aate hain',
    'Back pain since yesterday',
    'Meri aankhon se dhundhla dikhta hai',
  ])(
    'does not treat a common complaint alone as heart attack or stroke: %s',
    (text) => {
      expect(emergencyKind(text)).toBeNull();
    },
  );

  it('gives her heart attack reply, number first', () => {
    expect(emergencyMessage('मेरे सीने में बहुत दर्द है', true)).toBe(
      'ये दिल के दौरे के लक्षण हो सकते हैं, देर न करें। तुरंत 108 या 112 पर एम्बुलेंस के लिए फ़ोन करें, या पास के अस्पताल जाएँ।',
    );
  });

  it('gives her stroke reply', () => {
    expect(emergencyMessage('मुझे लकवा जैसा लग रहा है', true)).toBe(
      'ये स्ट्रोक (लकवे) के लक्षण हो सकते हैं, देर न करें। तुरंत 108 या 112 पर एम्बुलेंस के लिए फ़ोन करें, या पास के अस्पताल जाएँ।',
    );
  });

  it('lists the ASHA-module warning signs when asked about symptoms', () => {
    const message = emergencyMessage('Stroke ke symptoms kya hain?', true);
    expect(
      message.startsWith('स्ट्रोक (लकवे) के चेतावनी के संकेत ये हैं।'),
    ).toBe(true);
    expect(message).toContain('108 या 112');
    expect(message.split('\n')).toHaveLength(6);
  });

  it('falls back to her general emergency reply for other signs', () => {
    expect(emergencyMessage('Bahut zyada khoon beh raha hai', true)).toBe(
      EMERGENCY_MESSAGE.hi,
    );
    expect(EMERGENCY_MESSAGE.hi).toBe(
      'अगर तबीयत ज़्यादा खराब लग रही है, तो देर न करें। तुरंत 108 या 112 पर एम्बुलेंस के लिए फ़ोन करें, या पास के अस्पताल जाएँ। माफ़ कीजिए, इन लक्षणों से मैं नहीं बता सकती कि आपकी तकलीफ़ कितनी गंभीर है।',
    );
  });
});
