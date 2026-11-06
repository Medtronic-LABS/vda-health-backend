// Fixed answers approved in Dr. Garima's clinical review (round 2, 5 Nov 2026).
// Generated answers left out different points each time, so these topics get
// the same approved text however the patient asks. Hindi is her wording;
// English carries the same points. Up to ~100 words is allowed for counselling.

export type ApprovedAnswerTopic =
  | 'BP_CONTROL'
  | 'DIABETES_DIET'
  | 'EXERCISE'
  | 'TOBACCO'
  | 'DIABETES_PREVENTION'
  | 'HEALTHY_DIET'
  | 'FREE_MEDICINES'
  | 'FREE_TESTS'
  | 'LOW_SUGAR'
  | 'DIABETES_SIGNS'
  | 'WEIGHT_CHECK'
  | 'WEIGHT_RISKS';

interface ApprovedAnswer {
  summary: string;
  bullets: string[];
  link?: { text: string; url: string };
}

export const JAN_AUSHADHI_FINDER = 'https://janaushadhi.gov.in/near-by-kendra';

export const APPROVED_ANSWERS: Record<
  ApprovedAnswerTopic,
  { hi: ApprovedAnswer; en: ApprovedAnswer }
> = {
  BP_CONTROL: {
    hi: {
      summary: 'बीपी कंट्रोल करने के लिए तंबाकू और शराब से परहेज करें।',
      bullets: [
        'दिन में अधिकतम एक छोटा चम्मच यानी 5 ग्राम ही नमक लें।',
        'तली हुई और मीठी चीजों से बचें।',
        'ताजे फल, सब्जियां खाएं, वजन को नियंत्रित रखें और रोजाना कम से कम 30 मिनट व्यायाम करें।',
        'हर महीने अपना बीपी चेक करवाएँ और दवाओं का नियमित सेवन करें।',
      ],
    },
    en: {
      summary: 'To control your BP, avoid tobacco and alcohol.',
      bullets: [
        'Take no more than one small teaspoon, that is 5 grams, of salt in a day.',
        'Avoid fried and sweet foods.',
        'Eat fresh fruits and vegetables, keep your weight under control and exercise for at least 30 minutes every day.',
        'Get your BP checked every month and take your medicines regularly.',
      ],
    },
  },
  DIABETES_DIET: {
    hi: {
      summary:
        'रेशेदार भोजन जैसे फल, सब्जियां, साबुत अनाज और छिलके वाली दालें खाएं।',
      bullets: [
        'पॉलिश किए हुए अनाज और दालें कम खाएं।',
        'नमक और चीनी का सेवन कम करें। तली हुई और मीठी चीजों से बचें।',
        'बीड़ी, सिगरेट, गुटखा, तंबाकू और शराब से परहेज करें।',
        'अपना वजन नियंत्रित रखें और रोजाना कम से कम 30 मिनट व्यायाम करें।',
        'डॉक्टर की सलाह के अनुसार नियमित रूप से शुगर की जांच करवाएं और दवाएं समय पर लें।',
      ],
    },
    en: {
      summary:
        'Eat fibre-rich foods like fruits, vegetables, whole grains and pulses with skin.',
      bullets: [
        'Eat less polished grains and pulses.',
        'Reduce salt and sugar. Avoid fried and sweet foods.',
        'Stay away from bidi, cigarettes, gutkha, tobacco and alcohol.',
        'Keep your weight under control and exercise for at least 30 minutes every day.',
        'Get your sugar checked regularly as your doctor advises, and take your medicines on time.',
      ],
    },
  },
  EXERCISE: {
    hi: {
      summary:
        'रोज़ एक्सरसाइज़ या शारीरिक गतिविधि करने से शरीर का वजन नियंत्रित रहता है।',
      bullets: [
        'यह दिल की बीमारियों, लकवा, हाई BP, शुगर और कैंसर से बचाव करती है।',
        'इससे हड्डियां, मांसपेशियां मजबूत होती हैं और घुटनों और रीढ़ की हड्डी का दर्द जैसी समस्याओं से बचाव होता है।',
        'मानसिक स्वास्थ्य भी अच्छा रहता है।',
      ],
    },
    en: {
      summary:
        'Daily exercise or physical activity keeps your weight under control.',
      bullets: [
        'It protects against heart disease, paralysis (stroke), high BP, sugar and cancer.',
        'It makes bones and muscles strong and helps prevent problems like knee and back pain.',
        'It is also good for your mental health.',
      ],
    },
  },
  TOBACCO: {
    hi: {
      summary: 'टोबैको और स्मोकिंग से कई नुकसान होते हैं।',
      bullets: [
        'इससे अल्पकालिक समस्याएं जैसे दमा, दांतों और मसूड़े की बीमारी हो सकती है।',
        'लंबे समय में मोतियाबिंद और मुंह, गले, फेफड़ों का कैंसर हो सकता है।',
        'टीबी, दिल का दौरा, BP, शुगर और गुर्दे की बीमारी होने की संभावना बढ़ जाती है। साँस लेने में परेशानी हो सकती है।',
        'पुरुषों में नपुंसकता एवं प्रजनन क्षमता में कमी हो सकती है।',
      ],
    },
    en: {
      summary: 'Tobacco and smoking cause many harms.',
      bullets: [
        'In the short term they can cause asthma and disease of the teeth and gums.',
        'In the long term they can cause cataract and cancer of the mouth, throat and lungs.',
        'They raise the risk of TB, heart attack, BP, sugar and kidney disease, and can cause breathing problems.',
        'In men they can cause impotence and lower fertility.',
      ],
    },
  },
  DIABETES_PREVENTION: {
    hi: {
      summary: 'डायबिटीज से बचाव के लिए वजन नियंत्रित रखें।',
      bullets: [
        'हफ्ते में कम से कम 5 दिन 30 मिनट कसरत करें।',
        'संतुलित भोजन लें और मीठा व नमक कम खाएं, तली हुई चीजों से परहेज करें।',
        'बीड़ी, सिगरेट, गुटखा, तंबाकू और शराब का सेवन न करें।',
        'हर साल अपनी शुगर की जाँच करवाएँ।',
      ],
    },
    en: {
      summary: 'To prevent diabetes, keep your weight under control.',
      bullets: [
        'Exercise for 30 minutes on at least 5 days a week.',
        'Eat balanced meals, eat less sugar and salt, and avoid fried foods.',
        'Do not use bidi, cigarettes, gutkha, tobacco or alcohol.',
        'Get your sugar checked every year.',
      ],
    },
  },
  HEALTHY_DIET: {
    hi: {
      summary:
        'संतुलित डाइट लें: मौसमी फल, हरी पत्तेदार सब्जियाँ, साबुत अनाज और छिलके वाली दालें खाएँ।',
      bullets: [
        'नमक, चीनी और तेल का कम इस्तेमाल करें। मिठाई और तले हुए भोजन कम खाएँ।',
        'लाल मांस के बजाय चिकन या मछली खाएँ। खाना बनाने में कम मात्रा में सरसों, मूँगफली या सोयाबीन का तेल इस्तेमाल करें।',
        'पर्याप्त पानी पिएँ। कोल्ड ड्रिंक, मीठे पेय और डिब्बाबंद जूस की जगह छाछ और नारियल पानी लें।',
      ],
    },
    en: {
      summary:
        'Eat a balanced diet: seasonal fruits, green leafy vegetables, whole grains and pulses with skin.',
      bullets: [
        'Use less salt, sugar and oil. Eat less sweets and fried food.',
        'Eat chicken or fish instead of red meat. Cook with a small amount of mustard, groundnut or soybean oil.',
        'Drink enough water. Choose buttermilk and coconut water instead of cold drinks, sugary drinks and packaged juice.',
      ],
    },
  },
  // From her note: free medicines at all public health facilities; generic
  // medicines at low prices in Jan Aushadhi Kendras (store finder link).
  FREE_MEDICINES: {
    hi: {
      summary:
        'सभी सरकारी अस्पतालों और स्वास्थ्य केंद्रों में दवाइयाँ मुफ़्त मिलती हैं।',
      bullets: ['जन औषधि केंद्रों पर जेनेरिक दवाइयाँ सस्ते दाम पर मिलती हैं।'],
      link: {
        text: 'पास का जन औषधि केंद्र इस वेबसाइट पर खोजें:',
        url: JAN_AUSHADHI_FINDER,
      },
    },
    en: {
      summary:
        'Medicines are free at all government hospitals and health centres.',
      bullets: [
        'Generic medicines are sold at low prices at Jan Aushadhi Kendras.',
      ],
      link: {
        text: 'Find a Jan Aushadhi Kendra near you on this website:',
        url: JAN_AUSHADHI_FINDER,
      },
    },
  },
  // From her note: free tests at government facilities; free dialysis at
  // selected district hospitals.
  FREE_TESTS: {
    hi: {
      summary:
        'सरकारी अस्पतालों और स्वास्थ्य केंद्रों में मुफ़्त जाँच की सुविधा है।',
      bullets: ['कुछ चुने हुए ज़िला अस्पतालों में डायलिसिस भी मुफ़्त होता है।'],
    },
    en: {
      summary:
        'Free tests are available at government hospitals and health centres.',
      bullets: ['Dialysis is also free at selected district hospitals.'],
    },
  },
  // Round 3 topics, worded from the Module for ASHA on NCDs and the CHO
  // supplementary module (both ACTIVE in the knowledge base).
  LOW_SUGAR: {
    hi: {
      summary:
        'डायबिटीज़ में शुगर 70 से नीचे जा सकती है, जैसे खाना देर से खाने पर या कुछ दवाओं के असर से।',
      bullets: [
        'लक्षण: काँपना, घबराहट, पसीना, चिड़चिड़ापन, उलझन, तेज़ धड़कन, चक्कर, भूख, जी मिचलाना, धुंधला दिखना, सिरदर्द और कमज़ोरी।',
        'लक्षण दिखते ही तुरंत थोड़ी चीनी, मिश्री, टॉफ़ी या बिस्कुट खाएँ। ऐसी चीज़ हमेशा साथ रखें।',
        'समय पर खाना खाएँ और खाना न छोड़ें।',
        'बार-बार शुगर कम हो तो डॉक्टर या CHO को ज़रूर बताएँ। बेहोशी या दौरा पड़े तो तुरंत 108 या 112 पर फ़ोन करें।',
      ],
    },
    en: {
      summary:
        'With diabetes, sugar can drop below 70, for example after a late meal or because of some medicines.',
      bullets: [
        'Signs: shaking, nervousness, sweating, irritability, confusion, fast heartbeat, dizziness, hunger, nausea, blurred vision, headache and weakness.',
        'As soon as you notice them, eat a little sugar, misri, a toffee or biscuits. Always carry something like this.',
        'Eat your meals on time and do not skip meals.',
        'If your sugar often goes low, tell your doctor or CHO. If someone faints or has a fit, call 108 or 112 right away.',
      ],
    },
  },
  DIABETES_SIGNS: {
    hi: {
      summary:
        'डायबिटीज़ के आम लक्षण हैं: बार-बार और ज़्यादा पेशाब आना, ज़्यादा प्यास लगना, ज़्यादा भूख लगना और वज़न कम होना।',
      bullets: [
        'शुरुआत में कई लोगों को महीनों तक कोई लक्षण नहीं होता।',
        'इसलिए साल में एक बार शुगर की जाँच कराएँ। सरकारी स्वास्थ्य केंद्रों पर यह जाँच मुफ़्त है।',
        'ऐसे लक्षण हों तो नज़दीकी स्वास्थ्य केंद्र पर शुगर की जाँच कराएँ।',
      ],
    },
    en: {
      summary:
        'Common signs of diabetes are passing urine often and in large amounts, feeling very thirsty, feeling very hungry and losing weight.',
      bullets: [
        'Many people have no signs for months at the start.',
        'So get your sugar checked once a year. The test is free at government health centres.',
        'If you have these signs, get your sugar checked at your nearest health centre.',
      ],
    },
  },
  WEIGHT_CHECK: {
    hi: {
      summary:
        'वज़न सही है या नहीं, यह दो तरीकों से देखा जाता है: कमर का नाप और बीएमआई।',
      bullets: [
        'कमर का नाप पुरुषों में 90 और महिलाओं में 80 सेंटीमीटर से ज़्यादा हो, तो बीमारियों का ख़तरा बढ़ जाता है।',
        'बीएमआई 18.5 से 22.9 के बीच सामान्य माना जाता है।',
        'अपना बीएमआई जानने के लिए अपनी लंबाई और वज़न बताइए, जैसे: लंबाई 160 सेंटीमीटर, वज़न 60 किलो।',
      ],
    },
    en: {
      summary:
        'There are two ways to check your weight: your waist size and your BMI.',
      bullets: [
        'A waist over 90 centimetres in men or 80 centimetres in women raises the risk of disease.',
        'A BMI between 18.5 and 22.9 is normal.',
        'To know your BMI, tell me your height and weight, for example: height 160 cm, weight 60 kg.',
      ],
    },
  },
  WEIGHT_RISKS: {
    hi: {
      summary: 'ज़्यादा वज़न से कई बीमारियों का ख़तरा बढ़ जाता है।',
      bullets: [
        'दिल की बीमारी, लकवा, हाई बीपी और डायबिटीज़।',
        'खून में चर्बी यानी कोलेस्ट्रॉल बढ़ना, नींद की परेशानी, जोड़ों और फेफड़ों की बीमारी, और कुछ तरह के कैंसर।',
        'वज़न घटाने के लिए तला हुआ, मीठा और चिकनाई कम खाएँ, रोज़ व्यायाम करें, और तंबाकू व शराब से बचें।',
        'जल्दी वज़न घटाने का दावा करने वाली गोली, चूर्ण या मिश्रण से बचें।',
      ],
    },
    en: {
      summary: 'Extra weight raises the risk of many diseases.',
      bullets: [
        'Heart disease, stroke, high BP and diabetes.',
        'High blood fat (cholesterol), sleep problems, joint and lung disease, and some cancers.',
        'To lose weight, eat less fried, sweet and fatty food, exercise every day, and avoid tobacco and alcohol.',
        'Avoid pills, churan or mixtures that promise quick weight loss.',
      ],
    },
  },
};

// Round 3: Dr. Garima named B K Civil Hospital for dialysis in Faridabad.
export const FARIDABAD_DIALYSIS = {
  hi: 'फ़रीदाबाद में डायलिसिस की सुविधा बी.के. सिविल अस्पताल में है।',
  en: 'In Faridabad, dialysis is available at B K Civil Hospital.',
};

const BP =
  /\b(?:bp|blood\s*pressure|hypertension)\b|बीपी|ब्लड\s*प्रेशर|रक्तचाप/iu;
const SUGAR =
  /\b(?:diabetes|diabetic|sugar|madhumeh)\b|डायबिटीज|डायबिटिक|शुगर|मधुमेह/iu;
const DIET =
  /\b(?:diet|food|foods|eat|eating|khana|khane|khaana|khau|khaun|bhojan|aahar)\b|डाइट|खाना|खाने|खाऊ|खाऊँ|खाऊं|भोजन|आहार|खान-पान/iu;
const LOW_SUGAR =
  /(?:\bsugar\b|शुगर|glucose|ग्लूकोज).{0,20}(?:\bkam\b|\blow\b|\bgir|\bghat|\bdown\b|कम|गिर|घट)|(?:\blow\b|\bkam\b|कम)\s*(?:blood\s*)?(?:sugar|शुगर)/iu;
const SIGNS =
  /\b(?:symptoms?|signs?|lakshan|nishani|pehchan|kaise\s*pata)\b|लक्षण|संकेत|पहचान|कैसे\s*पता/iu;
const WEIGHT =
  /\b(?:wajan|vajan|wazan|vazan|weight|motapa|motapan|obesity|overweight|mota|moti|bmi)\b|वजन|मोटापा|मोटापे|मोटा|मोटी|बीएमआई/iu;
const WEIGHT_NORMAL =
  /\b(?:normal|samanya|sahi|theek|thik|ideal|healthy|kitna|bmi)\b|सामान्य|सही|ठीक|कितना|नॉर्मल|बीएमआई/iu;
const FREE_OR_CHEAP =
  /\b(?:free|low\s*cost|cheap|cheaper|affordable|muft|mufat|sasti|saste|sasta|kam\s*(?:daam|kharch|paise))\b|मुफ्त|मुफ्त|फ्री|फ्री|सस्ती|सस्ते|सस्ता|कम\s*(?:दाम|खर्च|पैसे)/iu;

/**
 * Picks an approved topic for a general question. Questions about the
 * patient's own reports, readings or prescription keep their own routes.
 */
export function approvedAnswerTopic(text: string): ApprovedAnswerTopic | null {
  // Nukta letters arrive in two Unicode forms; the patterns are written without them.
  const input = text.normalize('NFD').replace(/़/gu, '');
  if (
    input.length > 120 ||
    /\b(?:report|result|reading|prescription)\b|रिपोर्ट|नतीजा|पर्ची/iu.test(
      input,
    )
  )
    return null;
  // Low sugar, even with a reading ("sugar 60, kam ho gayi"), but not
  // "how do I bring my sugar down" (कम करना).
  if (
    (LOW_SUGAR.test(input) || /hypoglyc|हाइपो/iu.test(input)) &&
    !/(?:कम|kam)\s*(?:कर|kar)|\blower\b|\breduce\b/iu.test(input)
  )
    return 'LOW_SUGAR';
  // "My weight is 70 kg, is that normal?" gets the weight check; with a
  // height too, bmiAnswer() answers instead.
  if (
    WEIGHT.test(input) &&
    WEIGHT_NORMAL.test(input) &&
    !/(?:कम|kam|घटा|ghata)\s*(?:कर|kar)|\b(?:reduce|lose|lower)\b/iu.test(input)
  )
    return 'WEIGHT_CHECK';
  if (/\d/u.test(input)) return null;
  // "Is the test free with the Ayushman card?" is a scheme-coverage question
  // (PM-JAY pays only on admission); the scheme answer handles it.
  const schemeQuestion =
    /ayushman|pm[\s-]*jay|golden\s*card|आयुष्मान|पीएम[\s-]*जे|गोल्डन\s*कार्ड/iu.test(
      input,
    );
  const medicineWord =
    /\b(?:medicines?|medications?|dawai|dawa|dava|tablets?|goli)\b|दवा|दवाई|दवाइयाँ|दवाइयां|गोली|मेडिसिन|जन\s*औषधि|jan\s*aushadhi|generic|जेनेरिक/iu;
  if (
    !schemeQuestion &&
    (FREE_OR_CHEAP.test(input) || /jan\s*aushadhi|जन\s*औषधि/iu.test(input)) &&
    medicineWord.test(input)
  )
    return 'FREE_MEDICINES';
  if (
    !schemeQuestion &&
    FREE_OR_CHEAP.test(input) &&
    /\b(?:tests?|janch|jaanch|dialysis)\b|जाँच|जांच|टेस्ट|डायलिसिस/iu.test(
      input,
    )
  )
    return 'FREE_TESTS';
  // Medicine questions (doses, side effects, stopping) are not counselling.
  if (medicineWord.test(input)) return null;
  if (SUGAR.test(input) && SIGNS.test(input)) return 'DIABETES_SIGNS';
  if (
    WEIGHT.test(input) &&
    /\b(?:harm|harms|risk|risks|problems?|diseases?|nuksan|nuksaan|khatra|bimari|bimariyan)\b|नुकसान|खतरा|हानि|बीमारी|बीमारियां|बीमारियाँ/iu.test(
      input,
    )
  )
    return 'WEIGHT_RISKS';
  if (
    /\b(?:tobacco|smoking|smoke|cigarettes?|bidi|beedi|gutkha|khaini)\b|टोबैको|तंबाकू|तम्बाकू|स्मोकिंग|धूम्रपान|बीडी|सिगरेट|गुटखा|खैनी/iu.test(
      input,
    ) &&
    /\b(?:harm|harms|harmful|damage|bad|effects?|nuksan|nuksaan|risk)\b|नुकसान|नुकसान|खतरा|खतरा|असर|हानि/iu.test(
      input,
    )
  )
    return 'TOBACCO';
  if (
    /\b(?:exercise|exercising|workout|physical\s*activity|vyayam|kasrat)\b|एक्सरसाइज|एक्सरसाइज|व्यायाम|कसरत|शारीरिक\s*गतिविधि/iu.test(
      input,
    ) &&
    /\b(?:why|important|benefits?|good|zaroori|jaruri|zaruri|kyu|kyon|kyun|fayda|faayda)\b|क्यों|जरूरी|जरूरी|फायदा|फायदा|लाभ/iu.test(
      input,
    )
  )
    return 'EXERCISE';
  if (
    SUGAR.test(input) &&
    /\b(?:prevent|prevention|avoid|bachav|bachaav|bachne|bache|bachu)\b|बचाव|बचने|बचें|बचूं|बचूँ|रोकथाम/iu.test(
      input,
    )
  )
    return 'DIABETES_PREVENTION';
  if (SUGAR.test(input) && DIET.test(input)) return 'DIABETES_DIET';
  if (
    BP.test(input) &&
    /\b(?:control|controlled|manage|lower|reduce|kam)\b|कंट्रोल|नियंत्रित|नियंत्रण|कम\s*कर/iu.test(
      input,
    )
  )
    return 'BP_CONTROL';
  if (
    !BP.test(input) &&
    /\b(?:diet|healthy\s*food|balanced\s*food)\b|डाइट|आहार/iu.test(input) &&
    /\b(?:what|kya|which)\b|क्या/iu.test(input)
  )
    return 'HEALTHY_DIET';
  return null;
}

// BMI categories from the CHO supplementary module on NCDs (Asian cut-offs).
const BMI_BANDS: Array<{ below: number; hi: string; en: string }> = [
  { below: 18.5, hi: 'कम वज़न की', en: 'underweight' },
  { below: 23, hi: 'सामान्य', en: 'normal' },
  { below: 25, hi: 'ज़्यादा वज़न की', en: 'overweight' },
  { below: Infinity, hi: 'मोटापे की', en: 'obesity' },
];

/** Height in centimetres from "160 cm", "1.6 m" or "5 feet 4 inch". */
function heightCm(input: string): number | null {
  const cm = input.match(
    /(\d{2,3}(?:\.\d)?)\s*(?:cm|सेमी|सेंटीमीटर|centimet(?:er|re)s?)/iu,
  );
  if (cm) return Number(cm[1]);
  const m = input.match(
    /(\d\.\d{1,2})\s*(?:m|meters?|metres?|मीटर)(?![a-z])/iu,
  );
  if (m) return Number(m[1]) * 100;
  const ft = input.match(
    /(\d)\s*(?:feet|foot|ft|फुट|फीट|')\s*(?:(\d{1,2})\s*(?:inch(?:es)?|in|इंच|")?)?/iu,
  );
  return ft ? (Number(ft[1]) * 12 + Number(ft[2] ?? 0)) * 2.54 : null;
}

/**
 * Round 3: "is my weight normal?" with a height and weight works out the BMI
 * and its category; null unless both are given and plausible.
 */
export function bmiAnswer(
  text: string,
): { hi: ApprovedAnswer; en: ApprovedAnswer } | null {
  const input = text.normalize('NFD').replace(/़/gu, '');
  const kg = input.match(
    /(\d{2,3}(?:\.\d)?)\s*(?:kgs?|kilo(?:gram)?s?|किलो(?:ग्राम)?|किग्रा)/iu,
  );
  const cm = heightCm(input);
  if (!kg || !cm) return null;
  const weight = Number(kg[1]);
  if (cm < 100 || cm > 220 || weight < 20 || weight > 250) return null;
  const bmi = Math.round((weight / (cm / 100) ** 2) * 10) / 10;
  const band = BMI_BANDS.find((b) => bmi < b.below)!;
  const advice =
    band.en === 'underweight'
      ? {
          hi: 'पोषण और वज़न के बारे में नज़दीकी डॉक्टर या CHO से सलाह लें।',
          en: 'Ask your nearest doctor or CHO for advice on food and weight.',
        }
      : band.en === 'normal'
        ? {
            hi: 'संतुलित खाना और रोज़ कम से कम 30 मिनट व्यायाम जारी रखें।',
            en: 'Keep eating a balanced diet and exercising for at least 30 minutes every day.',
          }
        : {
            hi: 'तला हुआ, मीठा और चिकनाई कम खाएँ, रोज़ कम से कम 30 मिनट व्यायाम करें, और नज़दीकी डॉक्टर या CHO से सलाह लें।',
            en: 'Eat less fried, sweet and fatty food, exercise for at least 30 minutes every day, and ask your nearest doctor or CHO for advice.',
          };
  return {
    hi: {
      summary: `आपका बीएमआई लगभग ${bmi} है। सरकारी मानकों के अनुसार यह ${band.hi} श्रेणी में आता है।`,
      bullets: [
        'बीएमआई 18.5 से कम: कम वज़न। 18.5 से 22.9: सामान्य। 23 से 24.9: ज़्यादा वज़न। 25 या ज़्यादा: मोटापा।',
        advice.hi,
        'कमर का नाप भी देखें: पुरुषों में 90 और महिलाओं में 80 सेंटीमीटर से ज़्यादा न हो।',
      ],
    },
    en: {
      summary: `Your BMI is about ${bmi}. By government standards, this is in the ${band.en} range.`,
      bullets: [
        'BMI below 18.5: underweight. 18.5 to 22.9: normal. 23 to 24.9: overweight. 25 or more: obesity.',
        advice.en,
        'Also check your waist: it should not be over 90 centimetres in men or 80 centimetres in women.',
      ],
    },
  };
}
