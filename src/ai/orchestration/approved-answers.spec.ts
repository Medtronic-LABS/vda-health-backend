import {
  approvedAnswerTopic,
  APPROVED_ANSWERS,
  bmiAnswer,
} from './approved-answers';

describe('approved answers (clinical review round 2)', () => {
  it.each([
    ['मुझे बीपी कंट्रोल करने के लिए क्या करना चाहिए?', 'BP_CONTROL'],
    ['Mujhe BP control karne ke liye kya karna chahiye?', 'BP_CONTROL'],
    ['What should I do to control my blood pressure?', 'BP_CONTROL'],
    ['डायबिटीज में खाने का क्या ध्यान रखूँ?', 'DIABETES_DIET'],
    ['Diabetes mein khane ka kya dhyan rakhu?', 'DIABETES_DIET'],
    [
      'What should I keep in mind about my diet if I have diabetes?',
      'DIABETES_DIET',
    ],
    ['रोज़ एक्सरसाइज़ करना क्यों ज़रूरी है?', 'EXERCISE'],
    ['Roz exercise karna kyun zaroori hai?', 'EXERCISE'],
    ['टोबैको और स्मोकिंग से क्या नुकसान होता है?', 'TOBACCO'],
    ['बीड़ी पीने से क्या नुक़सान है?', 'TOBACCO'],
    ['डायबिटीज से बचाव के लिए क्या करना चाहिए?', 'DIABETES_PREVENTION'],
    ['मुझे डाइट में क्या खाना चाहिए?', 'HEALTHY_DIET'],
    [
      'Where can I get free medicines or medicines at low cost?',
      'FREE_MEDICINES',
    ],
    ['मुफ़्त दवाई कहाँ मिलेगी?', 'FREE_MEDICINES'],
    ['Where can I get free tests or tests at low cost?', 'FREE_TESTS'],
    ['मुफ्त डायलिसिस कहाँ होता है?', 'FREE_TESTS'],
    ['Sugar kam hone ke symptoms kya hain aur kya karein?', 'LOW_SUGAR'],
    ['मेरी शुगर कम हो गई है', 'LOW_SUGAR'],
    ['What are the symptoms of low blood sugar?', 'LOW_SUGAR'],
    ['Diabetes ke common signs kya hain?', 'DIABETES_SIGNS'],
    ['डायबिटीज के लक्षण क्या हैं?', 'DIABETES_SIGNS'],
    ['Kya mera wajan normal hai?', 'WEIGHT_CHECK'],
    ['मेरा वज़न 70 किलो है, क्या यह सामान्य है?', 'WEIGHT_CHECK'],
    ['Jyada wajan ke nuksan kya hain?', 'WEIGHT_RISKS'],
    ['मोटापे से क्या खतरा है?', 'WEIGHT_RISKS'],
  ])('%s -> %s', (question, topic) => {
    expect(approvedAnswerTopic(question)).toBe(topic);
  });

  it.each([
    'मेरी दवाइयों के नाम बताओ।',
    'BP ki dawai band kar du?',
    'My sugar is 300, what should I eat?',
    'Where can I get an X-ray done?',
    'मुझे डायबिटीज के बारे में सिंपल हिंदी में समझाओ',
    'My BP or sugar is very high despite taking medicines, what shall I do?',
    'क्या आयुष्मान कार्ड से बिना भर्ती हुए जाँच मुफ़्त होती है?',
    'Sugar kam karne ke liye kya karein?',
    'Wajan kam karne ke liye kya sahi hai?',
  ])('keeps its own route: %s', (question) => {
    expect(approvedAnswerTopic(question)).toBeNull();
  });

  it('keeps every answer within the 100-word counselling limit, in both languages', () => {
    for (const answer of Object.values(APPROVED_ANSWERS)) {
      for (const text of [answer.hi, answer.en]) {
        const words = [text.summary, ...text.bullets].join(' ').split(/\s+/);
        expect(words.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('gives Hindi and English the same number of points', () => {
    for (const answer of Object.values(APPROVED_ANSWERS)) {
      expect(answer.hi.bullets).toHaveLength(answer.en.bullets.length);
      expect(answer.hi.link?.url).toBe(answer.en.link?.url);
    }
  });

  it.each([
    ['Lambai 160 cm, wajan 70 kg', 27.3, 'obesity'],
    ['मेरी लंबाई 5 फुट 4 इंच और वज़न 60 किलो है', 22.7, 'normal'],
    ['height 1.7 m weight 50 kg', 17.3, 'underweight'],
    ['I am 165 cm and 66 kg, is my weight normal?', 24.2, 'overweight'],
  ])('works out the BMI: %s', (text, bmi, band) => {
    const answer = bmiAnswer(text)!;
    expect(answer.en.summary).toBe(
      `Your BMI is about ${bmi}. By government standards, this is in the ${band} range.`,
    );
    expect(answer.hi.bullets).toHaveLength(answer.en.bullets.length);
  });

  it('needs both a plausible height and weight for a BMI', () => {
    expect(bmiAnswer('mera wajan 70 kg hai')).toBeNull();
    expect(bmiAnswer('height 40 cm weight 70 kg')).toBeNull();
    expect(bmiAnswer('sugar 160 hai')).toBeNull();
  });
});
