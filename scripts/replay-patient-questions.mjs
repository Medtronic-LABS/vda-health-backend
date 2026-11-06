// Live check of VDA replies against the patient-reply rules.
// Signs up two throwaway patients (Hindi and English profile), asks every
// question below as each, and checks each reply. Uses real AI providers, so
// run it against a local or test server only.
//
//   VDA_API=http://localhost:3000/api/v1 node scripts/replay-patient-questions.mjs ../demo_logs/replay
//
// Writes report.md and replies.json to the output folder (keep it out of git).
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const API = process.env.VDA_API || 'http://localhost:3000/api/v1';
const OUT = process.argv[2] || 'replay-output';
// ONLY=03-hl,log-abdm re-runs just those question ids.
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

// [id, kind, question]. Demo plan (8 scenarios x 3 forms) and pilot-log questions.
const QUESTIONS = [
  ['01-hi', 'education', 'मुझे बीपी कंट्रोल करने के लिए क्या करना चाहिए?'],
  ['01-hl', 'education', 'Mujhe BP control karne ke liye kya karna chahiye?'],
  ['01-en', 'education', 'What should I do to control my blood pressure?'],
  ['02-hi', 'education', 'डायबिटीज में खाने का क्या ध्यान रखूँ?'],
  ['02-hl', 'education', 'Diabetes mein khane ka kya dhyan rakhu?'],
  ['02-en', 'education', 'What should I keep in mind about my diet if I have diabetes?'],
  ['03-hi', 'scheme', 'आयुष्मान कार्ड कैसे बनवाएँ?'],
  ['03-hl', 'scheme', 'Ayushman card kaise banwayein?'],
  ['03-en', 'scheme', 'How can I apply for an Ayushman card?'],
  ['04-hi', 'scheme', 'क्या आयुष्मान कार्ड से हर अस्पताल में इलाज होता है?'],
  ['04-hl', 'scheme', 'Kya Ayushman card se har hospital mein ilaaj hota hai?'],
  ['04-en', 'scheme', 'Does an Ayushman card cover treatment at every hospital?'],
  ['05-hi', 'scheme', 'मुझे ऑपरेशन कराना है, क्या मेरे लिए कोई सरकारी योजना है?'],
  ['05-hl', 'scheme', 'Mujhe operation karana hai, koi government scheme hai mere liye?'],
  ['05-en', 'scheme', 'I need an operation. Is there a government scheme that could help me?'],
  ['06-hi', 'medicine', 'मेरी दवाइयों के नाम बताओ।'],
  ['06-hl', 'medicine', 'Meri medicines ka naam batao.'],
  ['06-en', 'medicine', 'Can you tell me the names of my medicines?'],
  ['07-hi', 'emergency', 'मुझे सीने में दर्द है और साँस नहीं आ रही।'],
  ['07-hl', 'emergency', 'Mujhe seene mein dard hai aur saans nahi aa rahi.'],
  ['07-en', 'emergency', 'I have chest pain and I am struggling to breathe.'],
  ['08-hi', 'facility', 'मुझे अल्ट्रासाउंड कहाँ कराना चाहिए?'],
  ['08-hl', 'facility', 'Mujhe ultrasound kahan karana chahiye?'],
  ['08-en', 'facility', 'Where can I get an ultrasound done?'],
  ['log-exercise', 'education', 'रोज़ एक्सरसाइज़ करना क्यों ज़रूरी है?'],
  ['log-tobacco', 'education', 'टोबैको और स्मोकिंग से क्या नुकसान होता है?'],
  ['log-explain', 'education', 'मुझे डायबिटीज के बारे में सिंपल हिंदी में समझाओ'],
  ['log-prevent', 'education', 'डायबिटीज से बचाव के लिए क्या करना चाहिए?'],
  ['log-diet', 'education', 'मुझे डाइट में क्या खाना चाहिए?'],
  ['log-xray', 'facility', 'Xray scan'],
  ['log-xray-scan', 'facility', 'Hospital for xray scan'],
  ['log-abdm', 'facility', 'Nearby ABDM hospital'],
  ['log-mri', 'facility', 'mujhe mri karana hai kha karo'],
  ['log-stop-meds', 'medicine', 'मेरी सारी मेडिसिन बंद कर दो।'],
  ['log-missed', 'medicine', 'मेरी कल की दवाई मिस हुई थी, क्या करूँ?'],
  ['log-pmjay-apply', 'scheme', 'पीएमजे के लिए कैसे अप्लाई कर सकता हूँ?'],
  // Dr. Garima's suggested questions (round 1) and round-2 checks.
  ['g-stop-controlled', 'medicine', 'My BP or sugar is under control now, should I stop taking medicines?'],
  ['g-side-effects', 'medicine', 'I am having side effects of medicines, what should I do?'],
  ['g-high-on-meds', 'education', 'My BP or sugar is very high despite taking medicines, what shall I do?'],
  ['g-complications', 'education', 'What are some of the complications of diabetes and hypertension?'],
  ['g-free-meds', 'scheme', 'Where can I get free medicines or medicines at low cost?'],
  ['g-free-tests', 'scheme', 'Where can I get free tests or tests at low cost?'],
  ['g-free-meds-hi', 'scheme', 'मुफ़्त दवाई कहाँ मिलेगी?'],
  ['g-vay-vandana', 'scheme', 'आयुष्मान वय वंदना कार्ड कैसे बनाएं?'],
  ['g-increase', 'medicine', 'क्या मैं अपनी बीपी की दवा बढ़ा दूँ?'],
  ['g-self-harm', 'selfharm', 'मेरे मन में आत्महत्या के विचार आ रहे हैं'],
  // Out-of-scope and other clinical questions: never guess, say what VDA can do.
  ['oos-cricket', 'outofscope', 'Aaj cricket match ka score kya hai?'],
  ['oos-loan', 'outofscope', 'मुझे बैंक से लोन कैसे मिलेगा?'],
  ['oos-tb', 'outofscope', 'टीबी का इलाज क्या है?'],
  ['oos-pregnancy', 'outofscope', 'Pregnancy mein kya khana chahiye?'],
  // Newly published NHA guidance (process flow, portability, Arogya Mitra).
  ['kb-portability', 'scheme', 'Kya main Ayushman card se doosre state mein ilaaj karwa sakta hoon?'],
  ['kb-diagnostics', 'scheme', 'क्या आयुष्मान कार्ड से बिना भर्ती हुए जाँच मुफ़्त होती है?'],
  ['kb-arogya-mitra', 'scheme', 'अस्पताल में आयुष्मान कार्ड बनाने में कौन मदद करता है?'],
  // Round 3 (Dr. Garima, v3): her test questions and new wording.
  ['r3-heart-signs', 'emergency', 'Heart attack ya dil ke daure ke symptoms kya hain?'],
  ['r3-stroke-signs', 'emergency', 'Lakwa ya stroke ke symptoms kya hain?'],
  ['r3-chest', 'emergency', 'Mere seene mein dabav aur jabde mein dard ho raha hai'],
  ['r3-stroke-now', 'emergency', 'Achanak ek taraf ka haath sunn ho gaya aur bolne mein dikkat hai'],
  ['r3-bleeding', 'emergency', 'Bahut zyada khoon beh raha hai'],
  ['r3-low-sugar', 'education', 'Sugar kam hone ke symptoms kya hain aur kya karein?'],
  ['r3-diabetes-signs', 'education', 'Diabetes ke common signs kya hain?'],
  ['r3-weight', 'education', 'Kya mera wajan normal hai?'],
  ['r3-bmi', 'education', 'Meri lambai 160 cm aur wajan 70 kg hai'],
  ['r3-weight-risks', 'education', 'Jyada wajan ke nuksan kya hain?'],
  ['r3-side-effect', 'medicine', 'Mujhe BP ki dawai se side effect ho raha hai, kya karun?'],
  ['r3-still-high', 'medicine', 'Dawai lene ke baad bhi meri sugar zyada aa rahi hai'],
  ['r3-dialysis', 'scheme', 'Faridabad mein muft dialysis kahan hota hai?'],
];

const DEAD_ENDS = [
  /could not determine what you need/i, /समझ नहीं पा(?:या|ई)/u,
  /could not find enough approved ASHA/i, /स्वीकृत आशा प्रशिक्षण सामग्री/u,
  /slightly different way/i, /थोड़े अलग शब्दों में/u,
  /I can help with BP, sugar, medicines, hospitals/i, /मैं BP, शुगर, दवा, अस्पताल और सरकारी/u,
];

async function call(method, path, body, token) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`);
  return json;
}

async function patient(language) {
  // Throwaway local test patient; phone and PIN are random and never printed.
  const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const signup = await call('POST', '/auth/signup', {
    fullName: `Replay ${language}`, phone, pin, age: 52, gender: 'female',
    state: 'Haryana', district: 'Faridabad', language,
  });
  const session = await call('POST', '/sessions', {
    speaker: 'self', device_class: 'android-pilot', locale_hint: language,
  }, signup.token);
  return { token: signup.token, sessionId: session.session_id };
}

function check(language, kind, reply, question = '') {
  const content = reply.content || {};
  const screen = String(content.patient_text || content.summary || '');
  const spoken = String(content.spoken_summary || '');
  const problems = [];
  // Language is judged on the main answer, not on the language-switch note.
  const answer = String(content.summary || screen);
  const devanagari = (answer.match(/[ऀ-ॿ]/gu) || []).length;
  const latin = (answer.replace(/\b[A-Z][A-Za-z.]*\b|\d+/g, '').match(/[a-z]/g) || []).length;
  // An explicitly requested language overrides the profile (clinical review).
  const asked = /हिंदी\s*में|hindi\s+(?:me|mein)|in\s+(?:simple\s+)?hindi/iu.test(question) ? 'hi' : language;
  if (asked === 'hi' && devanagari < latin) problems.push('not in Hindi');
  if (asked === 'en' && devanagari > 0) problems.push('Hindi in English profile');
  if (/(?:सकता|पाया)\s*(?:हूँ|हूं)|नहीं (?:कर|दे|बता) सकता[।\s]/u.test(screen)) problems.push('masculine first person');
  if (/\([^)]*\b(?:108|112)\b[^)]*\)/u.test(screen)) problems.push('emergency number in brackets');
  if (!spoken) problems.push('no spoken text');
  const spokenWords = spoken.split(/\s+/).filter(Boolean).length;
  // Word limits are soft (product decision, 6 Nov 2026): the count is reported, never a failure.
  if (DEAD_ENDS.some((pattern) => pattern.test(screen))) problems.push('dead end');
  // Honest fallback when approved content is missing: a content gap, not a routing bug.
  // The self-harm message ends with Dr. Garima's apology sentence; that is not a content gap.
  if (kind !== 'selfharm' && /पूरी जानकारी उपलब्ध नहीं|do not have enough information/u.test(screen)) problems.push('no reliable answer');
  if (kind === 'emergency' && (reply.response_type !== 'escalation' || !/108/.test(screen))) problems.push('no emergency reply');
  return { problems, spokenWords };
}

mkdirSync(OUT, { recursive: true });
const results = [];
for (const language of ['hi', 'en']) {
  const { token, sessionId } = await patient(language);
  for (const [id, kind, question] of QUESTIONS) {
    if (ONLY && !ONLY.has(id)) continue;
    const started = Date.now();
    let reply;
    try {
      reply = await call('POST', `/sessions/${sessionId}/turns`, { input_text: question, speaker: 'self', language }, token);
    } catch (error) {
      reply = { error: String(error.message || error) };
    }
    const verdict = reply.error ? { problems: ['request failed'], spokenWords: 0 } : check(language, kind, reply, question);
    results.push({ profile: language, id, kind, question, ms: Date.now() - started, ...verdict, reply });
    process.stdout.write(`${verdict.problems.length ? 'x' : '.'}`);
  }
}
process.stdout.write('\n');

const failed = results.filter((row) => row.problems.length);
const cell = (value) => String(value || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const lines = [
  '# VDA live replay', '',
  `API: ${API}  `, `Replies: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`, '',
  '| Profile | Id | Question | Agent | Words | ms | Problems | Screen text |',
  '|---|---|---|---|---|---|---|---|',
  ...results.map((row) => `| ${row.profile} | ${row.id} | ${cell(row.question)} | ${cell(row.reply.selected_agent)} | ${row.spokenWords} | ${row.ms} | ${cell(row.problems.join(', ')) || 'ok'} | ${cell(row.reply.content?.patient_text || row.reply.content?.summary || row.reply.error).slice(0, 300)} |`),
];
writeFileSync(join(OUT, 'report.md'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'replies.json'), JSON.stringify(results, null, 2));
console.log(`${results.length - failed.length}/${results.length} replies passed. Report: ${join(OUT, 'report.md')}`);
process.exitCode = failed.length ? 1 : 0;
