// Standard messages approved in Dr. Garima's clinical review (rounds 1 and 2).
// Hindi is her wording; English carries the same facts. Emergency and
// self-harm messages give the number first and the apology after.

/** Standard messages 1 and 5: emergency signs, or symptoms VDA cannot judge (round 3 wording). */
export const EMERGENCY_MESSAGE = {
  hi: 'अगर तबीयत ज़्यादा खराब लग रही है, तो देर न करें। तुरंत 108 या 112 पर एम्बुलेंस के लिए फ़ोन करें, या पास के अस्पताल जाएँ। माफ़ कीजिए, इन लक्षणों से मैं नहीं बता सकती कि आपकी तकलीफ़ कितनी गंभीर है।',
  en: 'If you feel very unwell, do not wait. Call 108 or 112 for an ambulance right away, or go to the nearest hospital. Sorry, I cannot tell from these symptoms how serious your problem is.',
};

/** Standard message 2: thoughts of self-harm (Tele-MANAS helpline). */
export const SELF_HARM_MESSAGE = {
  hi: 'अगर आपके मन में खुद को नुकसान पहुँचाने के विचार आ रहे हैं, तो कृपया अभी मदद लें। नजदीकी डॉक्टर या स्वास्थ्य कर्मी से तुरंत बात करें। आप मानसिक स्वास्थ्य हेल्पलाइन से टोल-फ्री नंबर 14416 या 1800-891-4416 पर भी बात कर सकते हैं। माफ़ कीजिए, मेरे पास अभी इस सवाल का जवाब देने के लिए पूरी जानकारी उपलब्ध नहीं है।',
  en: 'If you are having thoughts of harming yourself, please get help now. Talk to a nearby doctor or health worker right away. You can also call the free mental health helpline on 14416 or 1800-891-4416. Sorry, I do not have enough information to answer this.',
};

// Medicines: name only the action the patient asked about, send them to a
// doctor or CHO, and never tell them to stop, change or keep taking medicines
// on their own.

export type MedicationAction = 'INCREASE' | 'REDUCE' | 'STOP' | 'START';

const ACTION_PATTERNS: Array<[MedicationAction, RegExp]> = [
  ['INCREASE', /\b(?:increase|raise|badha\w*)\b|बढा/iu],
  ['REDUCE', /\b(?:decrease|reduce|lower|ghata\w*|kam)\b|घटा|कम\s*कर/iu],
  ['STOP', /\b(?:stop|quit|band|rok\w*|chhod\w*)\b|बंद|रोक|छोड/iu],
  ['START', /\b(?:start|begin|shuru)\b|शुरू/iu],
];

const ALL_MEDICINES =
  /\b(?:all|saari|sari|sare|saare|sab|sabhi)\b|सारी|सारे|सब|सभी/iu;

// Nukta letters arrive in two Unicode forms; the patterns are written without them.
const withoutNukta = (text: string) => text.normalize('NFD').replace(/़/gu, '');

export function medicationActionsAsked(text: string): MedicationAction[] {
  const input = withoutNukta(text);
  return ACTION_PATTERNS.filter(([, pattern]) => pattern.test(input)).map(
    ([action]) => action,
  );
}

/** "Stop all my medicines" may mean the reminders, not the medicines. */
export function asksToStopAllMedicines(text: string): boolean {
  return (
    ALL_MEDICINES.test(withoutNukta(text)) &&
    medicationActionsAsked(text).includes('STOP')
  );
}

const ACTION_HI: Record<MedicationAction, string> = {
  INCREASE: 'दवा बढ़ाने',
  REDUCE: 'दवा घटाने',
  STOP: 'दवा बंद करने',
  START: 'नई दवा शुरू करने',
};
const ACTION_EN: Record<MedicationAction, string> = {
  INCREASE: 'increase your medicine',
  REDUCE: 'reduce your medicine',
  STOP: 'stop your medicine',
  START: 'start a new medicine',
};

/** Standard message 3: a patient asks to change, stop or start a medicine. */
export function medicineChangeMessage(text: string, hindi: boolean): string {
  const actions = medicationActionsAsked(text);
  if (actions.length === 1) {
    return hindi
      ? `${ACTION_HI[actions[0]]} का फ़ैसला सिर्फ़ डॉक्टर कर सकते हैं। कृपया अपने डॉक्टर या CHO से बात करें।`
      : `Only a doctor can decide to ${ACTION_EN[actions[0]]}. Please talk to your doctor or CHO.`;
  }
  return hindi
    ? 'दवा बढ़ाने, घटाने, बंद करने या नई दवा शुरू करने का फ़ैसला सिर्फ़ डॉक्टर कर सकते हैं। कृपया अपने डॉक्टर या CHO से बात करें।'
    : 'Only a doctor can decide to increase, reduce, stop or start a medicine. Please talk to your doctor or CHO.';
}

/** Standard message 4: a dose decision, such as a missed or double dose. */
export const MEDICINE_DOSE_MESSAGE = {
  hi: 'माफ़ कीजिए, मैं दवा की खुराक बदलने, बंद करने, दोगुनी खुराक लेने या छूटी हुई खुराक के बारे में सलाह नहीं दे सकती। दवा से जुड़ी विस्तृत जानकारी के लिए कृपया नजदीकी डॉक्टर या कम्युनिटी हेल्थ ऑफिसर (CHO) से संपर्क करें।',
  en: 'Sorry, I cannot advise on changing, stopping, doubling or making up a missed dose. For details about your medicines, please contact your nearest doctor or Community Health Officer (CHO).',
};

/**
 * Round 2, Question 6: the medicines reply is Dr. Garima's wording; the
 * reminders line points to the app's Medicines tab, where reminders are cleared.
 */
export const STOP_ALL_MEDICINES_MESSAGE = {
  hi: {
    summary:
      'अपने मन से दवा न बंद करें और न ही बदलें। दवा से जुड़ी विस्तृत जानकारी के लिए कृपया नजदीकी डॉक्टर या कम्युनिटी हेल्थ ऑफिसर (CHO) से संपर्क करें।',
    reminders:
      'अगर आप दवा के रिमाइंडर बंद करना चाहते हैं, तो नीचे “दवाइयां” में जाकर “सभी रिमाइंडर हटाएं” दबाएँ।',
  },
  en: {
    summary:
      'Do not stop or change your medicines on your own. For details about your medicines, please contact your nearest doctor or Community Health Officer (CHO).',
    reminders:
      'If you want to switch off medicine reminders, open Medicines at the bottom and tap “Clear All Reminders”.',
  },
};

/**
 * Round 3: side effects of BP or sugar medicines (Dr. Garima's wording). BP or
 * sugar still high on medicines is not a side effect and has its own wording
 * (Dr. Garima, 8 Nov 2026).
 */
export const SIDE_EFFECT_MESSAGE = {
  hi: 'कभी-कभी मरीजों को बीपी/शुगर की कुछ दवाओं से दुष्प्रभाव हो सकते हैं। घबराएं नहीं, लेकिन जल्द से जल्द नजदीकी डॉक्टर या सीएचओ से मिलें। वे जरूरत के अनुसार दवा बदल सकते हैं और दवा के सही इस्तेमाल के बारे में सलाह दे सकते हैं। बीपी/शुगर का नियमित इलाज जरूरी है। बिना डॉक्टर की सलाह के दवा न बंद करें, न बदलें।',
  en: 'Sometimes BP or sugar medicines can cause side effects. Do not panic, but see your nearest doctor or CHO as soon as possible. They can change the medicine if needed and advise you on using it correctly. Regular treatment of BP and sugar is important. Do not stop or change your medicine without a doctor’s advice.',
};
export const STILL_HIGH_ON_MEDICINES_MESSAGE = {
  hi: 'अगर दवा लेने के बाद भी आपका बीपी/शुगर ज़्यादा है, तो नज़दीकी डॉक्टर या सीएचओ से मिलें। वे आपकी स्थिति के अनुसार दवा या उसकी खुराक बदल सकते हैं। डॉक्टर की सलाह के बिना दवा न बदलें, न बंद करें और न ही खुराक बढ़ाएँ।',
  en: 'If your BP or sugar is still high after taking your medicine, please visit your nearest doctor or CHO. They can change your medicine or adjust the dose for your condition. Do not change or stop your medicine, or increase the dose, without a doctor’s advice.',
};

// Round 3: warning signs of heart attack and stroke from the Module for ASHA on
// Non-Communicable Diseases, with Dr. Garima's reply for each.
export type EmergencyKind = 'HEART_ATTACK' | 'STROKE' | 'OTHER';

type SignList = { name: string; signs: string[] };

export const WARNING_SIGNS: Record<
  'HEART_ATTACK' | 'STROKE',
  { hi: SignList; en: SignList }
> = {
  HEART_ATTACK: {
    hi: {
      name: 'दिल के दौरे',
      signs: [
        'साँस लेने में तकलीफ या साँस न ले पाना।',
        'जबड़ों, गर्दन, बाँहों, कंधों या पीठ में दर्द होना।',
        'बेहोशी होना।',
        'उल्टी होना।',
        'छाती के बीच में दर्द, कसाव या दबाव 30 मिनट से अधिक समय तक महसूस होना।',
      ],
    },
    en: {
      name: 'a heart attack',
      signs: [
        'Difficulty breathing, or not being able to breathe.',
        'Pain in the jaw, neck, arms, shoulders or back.',
        'Fainting.',
        'Vomiting.',
        'Pain, tightness or pressure in the middle of the chest for more than 30 minutes.',
      ],
    },
  },
  STROKE: {
    hi: {
      name: 'स्ट्रोक (लकवे)',
      signs: [
        'अचानक तेज सिरदर्द होना या बेहोश हो जाना।',
        'बिना किसी कारण चक्कर आना, संतुलन बिगड़ना या अचानक गिर जाना।',
        'धुंधला दिखाई देना या दिखाई देना बंद हो जाना, विशेष रूप से एक आँख से कम दिखाई देना।',
        'आवाज चली जाना, बोलने में कठिनाई होना या दूसरे की बात समझने में परेशानी होना।',
        'अचानक कमजोरी, लकवा या चेहरे, बाँह और पैर में एक तरफ सुन्नपन होना।',
      ],
    },
    en: {
      name: 'a stroke (paralysis)',
      signs: [
        'A sudden severe headache, or fainting.',
        'Dizziness for no reason, losing balance, or falling suddenly.',
        'Blurred vision or loss of vision, especially seeing less from one eye.',
        'Losing your voice, difficulty speaking, or trouble understanding others.',
        'Sudden weakness, paralysis, or numbness on one side of the face, arm and leg.',
      ],
    },
  },
};

const CALL_HI =
  'देर न करें। तुरंत 108 या 112 पर एम्बुलेंस के लिए फ़ोन करें, या पास के अस्पताल जाएँ।';
const CALL_EN =
  'Do not wait. Call 108 or 112 for an ambulance right away, or go to the nearest hospital.';

// Written without nukta (see withoutNukta) and matched against lower-case text.
// Dr. Garima (8 Nov 2026): the heart-attack or stroke message only for alarming
// signs. General complaints on their own (vomiting, back or arm pain, getting
// breathless, dizziness or a headache) need "sudden", "one side" or the chest.
const HEART_SIGNS = [
  /heart\s*attack|हार्ट\s*अटैक|दिल\s*(?:का|के)\s*दौर|dil\s*(?:ka|ke)\s*daur/u,
  /(?:सीने|सीना|छाती|chest|seene|seena|sine|chhati|chati).{0,30}(?:दर्द|दबाव|कसाव|जकड|भारी|pain|pressure|tight|dard|dabav|dabaav|kasav|bhari)/u,
];
// Severe breathing difficulty is an emergency but not specific to the heart,
// so on its own it gets the general emergency message.
const BREATHING_SIGNS = [
  /(?:साँस|सांस|श्वास).{0,25}(?:नहीं|मुश्किल|दिक्कत|तकलीफ|रुक|अटक)|दम\s*घुट/u,
  /\b(?:saans|saas)\b.{0,30}(?:nahi|nahin|ruk|atak|mushkil|dikkat|taklif|takleef|ghut)|dam\s*ghut/u,
  /can(?:not|'t| not) breathe|unable to breathe|not breathing|struggling to breathe|hard to breathe|trouble breathing|gasping/u,
];
const STROKE_SIGNS = [
  /stroke|स्ट्रोक|लकवा|लकवे|lakwa|lakva|paralys|फालिज|falij/u,
  /(?:अचानक|achanak|sudden(?:ly)?).{0,25}(?:तेज\s*)?(?:सिरदर्द|सिर\s*(?:में\s*)?दर्द|sir\s*(?:me|mein)?\s*dard|sirdard|headache)/u,
  /(?:संतुलन|santulan|balance).{0,20}(?:बिगड|खो|bigad|kho|lost|loss|losing)|(?:अचानक|achanak|sudden(?:ly)?).{0,15}(?:गिर|gir|fell|fall|चक्कर|chakkar|dizz)/u,
  /(?:अचानक|achanak|sudden(?:ly)?).{0,25}(?:धुंधला|dhundhla|blur|दिखाई\s*(?:देना\s*)?बंद|dikhai\s*(?:dena\s*)?band|vision)|(?:एक\s*(?:आँख|आंख)|ek\s*aankh|one\s*eye).{0,25}(?:दिख|dikh|see|vision|धुंधला|dhundhla|blur)|दिखाई\s*देना\s*बंद|lost.{0,10}vision/u,
  /(?:आवाज|awaz|awaaz|aawaz).{0,10}(?:चली|बंद|chali|band)|बोलने\s*में\s*(?:कठिनाई|दिक्कत|तकलीफ|परेशानी)|bolne\s*(?:me|mein)\s*(?:dikkat|taklif|pareshani|mushkil)|बोली\s*लडखडा|boli\s*ladkhad|slurred|trouble speaking|difficulty speaking|can'?t speak|बात\s*समझने\s*में|samajhne\s*(?:me|mein)\s*(?:dikkat|pareshani)/u,
  /(?:एक\s*तरफ|ek\s*taraf|one\s*side|one-sided).{0,30}(?:कमजोर|सुन्न|weak|numb|kamzor|kamjor|sunn)|(?:कमजोर|सुन्न|weak|numb|kamzor|kamjor|sunn).{0,30}(?:एक\s*तरफ|ek\s*taraf|one\s*side)|(?:चेहरा|chehra|face).{0,15}(?:टेढ|tedha|droop)|(?:अचानक|achanak|sudden(?:ly)?).{0,20}(?:कमजोरी|सुन्न|weakness|numb|kamzori|kamjori|sunn)/u,
];
const ASKS_ABOUT_SIGNS =
  /लक्षण|संकेत|पहचान|symptoms?|signs?|lakshan|sanket|nishani|pehchan/u;

/**
 * HEART_ATTACK or STROKE when the text names one of that condition's alarming
 * signs; OTHER when it names both (VDA cannot tell which) or only severe
 * breathing difficulty; null for none.
 */
export function emergencyKind(text: string): EmergencyKind | null {
  const input = withoutNukta(text.toLowerCase());
  const heart = HEART_SIGNS.some((pattern) => pattern.test(input));
  const stroke = STROKE_SIGNS.some((pattern) => pattern.test(input));
  if (heart && stroke) return 'OTHER';
  if (heart) return 'HEART_ATTACK';
  if (stroke) return 'STROKE';
  return BREATHING_SIGNS.some((pattern) => pattern.test(input))
    ? 'OTHER'
    : null;
}

/**
 * The emergency reply. The call to 108 or 112 always comes first; a question
 * about the warning signs also gets the ASHA-module list.
 */
export function emergencyMessage(text: string, hindi: boolean): string {
  const kind = emergencyKind(text);
  if (!kind || kind === 'OTHER') return EMERGENCY_MESSAGE[hindi ? 'hi' : 'en'];
  const { name, signs } = WARNING_SIGNS[kind][hindi ? 'hi' : 'en'];
  if (ASKS_ABOUT_SIGNS.test(withoutNukta(text.toLowerCase()))) {
    const intro = hindi
      ? `${name} के चेतावनी के संकेत ये हैं। इनमें से कोई भी लक्षण हो तो ${CALL_HI}`
      : `These are the warning signs of ${name}. If you have any of them, do not wait. Call 108 or 112 for an ambulance right away, or go to the nearest hospital.`;
    return [intro, ...signs.map((sign) => `• ${sign}`)].join('\n');
  }
  return hindi
    ? `ये ${name} के लक्षण हो सकते हैं, ${CALL_HI}`
    : `These may be signs of ${name}. ${CALL_EN}`;
}
