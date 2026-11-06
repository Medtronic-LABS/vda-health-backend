import {
  Injectable,
  Logger,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IAiOrchestrator,
  AiOrchestratorRequest,
  AiOrchestratorResult,
} from './ai-orchestrator.interface';
import { HostIdentity } from '../../auth/host-identity.context';
import { IAiProvider } from '../interfaces/ai-provider.interface';
import { ILanguageProvider } from '../interfaces/language-provider.interface';
import { IIntentClassifier } from '../intents/intent-classifier.interface';
import { AgentRouterService } from '../../agents/agent-router.service';
import { ClinicalContextService } from '../../abdm/services/clinical-context.service';
import { ClinicalAiContextBuilder } from '../context/clinical-ai-context.builder';
import { ISafetyGate } from '../../safety/interfaces/safety-gate.interface';
import { AuditService } from '../../audit/audit.service';
import { ClinicalContext } from '../../abdm/models/clinical-context.models';
import { HealthRecordCategory } from '../../abdm/interfaces/health-record-service.interface';
import { ConversationHistoryService } from '../../conversations/services/conversation-history.service';
import {
  ConversationResponseFormatter,
  explicitlyRequestedLanguage,
} from '../../conversations/formatters/conversation-response.formatter';
import {
  KnowledgeRetrievalService,
  iphsServiceTermPattern,
} from '../../knowledge/services/knowledge-retrieval.service';
import { KnowledgeQueryNormalizerService } from '../../knowledge/services/knowledge-query-normalizer.service';
import { TerminologyResolverService } from '../../knowledge/services/terminology-resolver.service';
import { ModularPromptBuilder } from './modular-prompt.builder';
import { AgentKnowledgeMapper } from '../agents/agent-knowledge-mapper';
import {
  AuthorityCategory,
  IntentType,
  SchemeInformationType,
} from '../intents/intent.types';
import { Facility } from '../../database/entities/facility.entity';
import { FacilitySearchService } from '../../facilities/facility-search.service';
import {
  FacilityDirectoryEntry,
  FacilityDirectoryLoader,
} from '../../facilities/facility-directory.loader';
import { Scheme } from '../../database/entities/scheme.entity';
import { SchemeService } from '../../schemes/scheme.service';
import { Session } from '../../database/entities/session.entity';
import { Prescription } from '../../database/entities/prescription.entity';
import { RagasVerificationGateService } from '../verification/ragas-verification-gate.service';
import { ConversationTurn } from '../../database/entities/conversation-turn.entity';
import { FacilitySearchResult } from '../../facilities/facility-search.service';
import {
  collectSourceBackedServiceValues,
  matchSourceBackedServiceValues,
  prioritizeSourceBackedCandidates,
} from '../../facilities/facility-service-matcher';
import { IphsLevel } from '../../facilities/iphs-classification';
import { RagEvaluationService } from '../../evaluation/rag-evaluation.service';
import {
  KnowledgeRetrievalResult,
  KnowledgeSourceCitation,
} from '../../knowledge/models/knowledge-retrieval.model';
import {
  PATIENT_DATA_PROVIDER,
  PatientDataProvider,
  PatientDataRecord,
} from '../../dev/patient-data/patient-data-provider.interface';
import {
  LangSmithTracerService,
  TurnTraceContext,
} from '../../observability/langsmith-tracer.service';
import {
  PrescriptionSessionContextService,
  SanitizedPrescriptionInvestigation,
  SanitizedPrescriptionMedicine,
  SanitizedPrescriptionSessionContext,
} from '../../prescription-context/prescription-session-context.service';
import {
  asksToStopAllMedicines,
  emergencyMessage,
  MEDICINE_DOSE_MESSAGE,
  medicineChangeMessage,
  SIDE_EFFECT_MESSAGE,
  STILL_HIGH_ON_MEDICINES_MESSAGE,
  STOP_ALL_MEDICINES_MESSAGE,
} from '../../safety/standard-messages';
import {
  approvedAnswerTopic,
  APPROVED_ANSWERS,
  bmiAnswer,
  FARIDABAD_DIALYSIS,
} from './approved-answers';

type VerifiedIphsLevel = Exclude<IphsLevel, 'UNKNOWN'>;
type IphsEvidenceStatus = 'VERIFIED' | 'NOT_VERIFIED' | 'UNAVAILABLE';

/** Terminology found in the indexed IPHS 2022 documents; retrieval only. */
const IPHS_SERVICE_SEARCH_TERMS: Array<{
  service: RegExp;
  query: string;
  evidenceTerms: string[];
}> = [
  {
    service: /^(?:ultrasound|usg|sonography)$/i,
    query:
      'IPHS 2022 Ultrasound USG sonography diagnostic facility Community Health Centre District Hospital',
    evidenceTerms: ['Ultrasound', 'USG', 'sonography'],
  },
  {
    service: /^X-ray$/i,
    query: 'IPHS 2022 X-ray radiography diagnostic facility',
    evidenceTerms: ['X-ray', 'X ray', 'Xray', 'radiography'],
  },
  {
    service: /^MRI$/i,
    query: 'IPHS 2022 Magnetic Resonance Imaging MRI diagnostic facility',
    evidenceTerms: ['Magnetic Resonance Imaging', 'MRI'],
  },
  {
    service: /^ecg$/i,
    query: 'Electrocardiography ECG',
    evidenceTerms: ['Electrocardiography', 'ECG'],
  },
  {
    service: /^hba1c$/i,
    query: 'HbA1c glycosylated haemoglobin',
    evidenceTerms: [
      'HbA1c',
      'glycosylated haemoglobin',
      'glycosylated hemoglobin',
    ],
  },
  {
    service: /^blood glucose$/i,
    query: 'blood glucose blood sugar',
    evidenceTerms: ['blood glucose', 'blood sugar'],
  },
  {
    service: /^cbc$/i,
    query: 'CBC complete blood count Hematology',
    evidenceTerms: ['CBC', 'complete blood count'],
  },
];

interface FacilityServiceContext {
  requestedService: string;
  appropriateIphsLevels: VerifiedIphsLevel[];
  lowCostPreference: boolean;
  matchedSourceValues: string[];
  iphsSources: KnowledgeSourceCitation[];
  iphsEvidenceStatus: IphsEvidenceStatus;
}

type PrescriptionContextResolution =
  | { kind: 'MEDICINE_LIST' }
  | {
      kind: 'ADHERENCE_STATUS';
      question: 'PENDING' | 'MISSED' | 'STREAK' | 'CORRECTION';
    }
  | { kind: 'REFILL_SUPPORT' }
  | { kind: 'PRESCRIPTION_STATUS' }
  | { kind: 'MEDICINE_FACT'; medicine: SanitizedPrescriptionMedicine }
  | { kind: 'REMINDER_FACT'; medicine?: SanitizedPrescriptionMedicine }
  | { kind: 'CLINICAL_MEDICATION_DECISION'; decision: MedicationDecision }
  | { kind: 'INVESTIGATION_LIST' }
  | {
      kind: 'MEDICINE_EDUCATION';
      medicine: SanitizedPrescriptionMedicine;
      question: string;
    }
  | {
      kind: 'INVESTIGATION_EDUCATION';
      investigation: SanitizedPrescriptionInvestigation;
      question: string;
    }
  | {
      kind: 'MEDICINE_FOR_BP';
      medicines: SanitizedPrescriptionMedicine[];
      question: string;
    };

/** Narrow education route; the orchestrator applies it only after safety and identity checks. */
export function basicEducationTopic(
  inputText: string,
  patientAge: number | null | undefined,
): 'FEVER' | 'HBA1C' | null {
  if (
    inputText.length > 75 ||
    /\b(?:report|result|value|reading|dose|medicine|tablet|pill|prescription)\b|रिपोर्ट|नतीजा|मान|खुराक|दवा|गोली|पर्ची/u.test(
      inputText,
    ) ||
    /\d/u.test(inputText.replace(/\b(?:hba1c|a1c)\b/giu, ''))
  )
    return null;
  if (
    Number(patientAge) >= 18 &&
    /\b(?:fever|bukhar)\b|बुखार/u.test(inputText) &&
    !/\b(?:headache|cough|vomit|rash|pain|breath|pregnan|child)\b|सिरदर्द|सिर\s*दर्द|खांसी|खाँसी|उल्टी|दर्द|सांस|साँस|गर्भ/u.test(
      inputText,
    ) &&
    /\b(?:what should i do|what can i do|self care|kya karu|kya karun)\b|क्या\s*(?:करूं|करूँ|करना|करें)/iu.test(
      inputText,
    )
  )
    return 'FEVER';
  if (
    /\b(?:hba1c|a1c)\b|एच\s*बी\s*ए\s*वन\s*सी/iu.test(inputText) &&
    !/\b(?:my|mine|meri|mera|mujhe|i have)\b|मेरी|मेरा|मुझे/u.test(inputText) &&
    /\b(?:what|mean|meaning|explain|kya|hota|hai)\b|क्या|होता|समझा/u.test(
      inputText,
    )
  )
    return 'HBA1C';
  return null;
}

// When no answer can be trusted, say so honestly and give a next step;
// rephrasing cannot help when the approved information is missing.
export const NO_RELIABLE_ANSWER_HI =
  'माफ़ कीजिए, मेरे पास अभी इस सवाल का जवाब देने के लिए पूरी जानकारी उपलब्ध नहीं है। कृपया अपने क्षेत्र की आशा स्वास्थ्य कर्मी या नज़दीकी स्वास्थ्य केंद्र से संपर्क करें।';
export const NO_RELIABLE_ANSWER_EN =
  'Sorry, I do not have enough information to answer this yet. Please contact the ASHA worker in your area or your nearest health centre.';
// DOSE: missed/double dose; CHANGE: one named action; STOP_ALL: may mean the
// reminders; MEDICINE: other medicine worries (side effects, still high);
// GENERAL: diagnosis or treatment of an illness, with no medicine named.
export type MedicationDecision =
  | 'DOSE'
  | 'CHANGE'
  | 'STOP_ALL'
  | 'MEDICINE'
  | 'SIDE_EFFECT'
  | 'STILL_HIGH'
  | 'GENERAL';

/** A clinical question that is not about the patient's medicines. */
export const CLINICAL_ADVICE_MESSAGE = {
  hi: 'माफ़ कीजिए, मैं बीमारी की जाँच या इलाज के बारे में सलाह नहीं दे सकती। इसके लिए कृपया नजदीकी डॉक्टर या कम्युनिटी हेल्थ ऑफिसर (CHO) से संपर्क करें।',
  en: 'Sorry, I cannot advise on diagnosing or treating an illness. Please contact your nearest doctor or Community Health Officer (CHO).',
};

/** Picks the deflection for a clinical question the classifier sent here. */
export function clinicalQuestionKind(text: string): MedicationDecision {
  // Round 3: side effects, and BP or sugar still high on medicines.
  if (
    /\b(?:side\s*effects?|reaction|dushprabhav)\b|साइड\s*इफेक्ट|दुष्प्रभाव|रिएक्शन/iu.test(
      text,
    )
  )
    return 'SIDE_EFFECT';
  if (
    /(?:despite|even after|still|बावजूद|के\s*बाद\s*भी|पर\s*भी|फिर\s*भी|ke\s*baad\s*bhi|par\s*bhi|phir\s*bhi).{0,40}(?:high|zyada|jyada|ज़्यादा|ज्यादा|बढ़|बढ|badh)|(?:high|zyada|jyada|ज़्यादा|ज्यादा|बढ़|बढ|badh).{0,40}(?:despite|even after|बावजूद|के\s*बाद\s*भी|पर\s*भी|फिर\s*भी|ke\s*baad\s*bhi|par\s*bhi|phir\s*bhi)/iu.test(
      text,
    )
  )
    return 'STILL_HIGH';
  if (
    /\b(?:dose|dosage|double|missed?|skip(?:ped)?|bhool|bhul)\b|खुराक|दोगुनी|छूट|भूल/iu.test(
      text,
    )
  )
    return 'DOSE';
  return /\b(?:medicines?|medications?|tablets?|pills?|dawai|dawa|goli)\b|दवा|दवाई|गोली|मेडिसिन/iu.test(
    text,
  )
    ? 'MEDICINE'
    : 'GENERAL';
}

// Clinical review: Ayushman card answers give both routes, in person and online.
// The link stays on its own line; spoken text drops https links.
export const AYUSHMAN_ONLINE_PORTAL = 'https://beneficiary.nha.gov.in';
export const AYUSHMAN_ONLINE_SECTION = {
  hi: {
    title: 'ऑनलाइन आवेदन',
    body: `घर बैठे आयुष्मान ऐप या इस वेबसाइट से भी कार्ड बनवा सकते हैं:\n${AYUSHMAN_ONLINE_PORTAL}`,
  },
  en: {
    title: 'Apply online',
    body: `You can also apply from home on the Ayushman App or this website:\n${AYUSHMAN_ONLINE_PORTAL}`,
  },
};
// NHA videos from Dr. Garima (Vay Vandana playlist): the Hindi and English
// Ayushman App walkthroughs. Shown as a tappable link; the voice skips links.
export const VAY_VANDANA_VIDEO = {
  hi: {
    title: 'वीडियो देखें',
    body: 'आयुष्मान ऐप से वय वंदना कार्ड बनाने का तरीका इस वीडियो में देखें:\nhttps://www.youtube.com/watch?v=IHiHf-A7UT0',
  },
  en: {
    title: 'Watch a video',
    body: 'See how to make the Vay Vandana card on the Ayushman App in this video:\nhttps://www.youtube.com/watch?v=4tbf3lkhyjM',
  },
};
// Source: NHA "FAQs related to the benefits for senior citizens" (ACTIVE in the
// knowledge base): everyone aged 70+ is eligible whatever their income, and
// Aadhaar is the only document needed.
export const VAY_VANDANA_IN_PERSON_ANSWER = {
  hi: {
    summary: 'वय वंदना कार्ड आप केंद्र जाकर या ऑनलाइन बनवा सकते हैं।',
    title: 'केंद्र या अस्पताल जाकर',
    bullets: [
      '70 साल या उससे ज़्यादा उम्र के सभी लोग इसके पात्र हैं, आमदनी कुछ भी हो।',
      'पास के जन सेवा केंद्र या योजना से जुड़े अस्पताल में आरोग्य मित्र से मिलें।',
      'सिर्फ़ आधार कार्ड साथ ले जाएँ।',
    ],
  },
  en: {
    summary: 'You can get your Vay Vandana card at a centre or online.',
    title: 'At a centre or hospital',
    bullets: [
      'Everyone aged 70 or above can get it, whatever their income.',
      'Meet the Arogya Mitra at a Common Service Centre or an approved hospital.',
      'Take only your Aadhaar card.',
    ],
  },
};
// Used when a generated card-application answer cannot be verified.
export const AYUSHMAN_IN_PERSON_ANSWER = {
  hi: {
    summary: 'आयुष्मान कार्ड आप केंद्र जाकर या ऑनलाइन बनवा सकते हैं।',
    title: 'केंद्र या अस्पताल जाकर',
    bullets: [
      'पास के जन सेवा केंद्र या योजना से जुड़े अस्पताल में आरोग्य मित्र से मिलें।',
      'आधार कार्ड और राशन कार्ड साथ ले जाएँ।',
      'सूची में नाम मिलने पर आपका कार्ड बन जाएगा।',
    ],
  },
  en: {
    summary: 'You can get your Ayushman card at a centre or online.',
    title: 'At a centre or hospital',
    bullets: [
      'Meet the Arogya Mitra at a Common Service Centre or an approved hospital.',
      'Take your Aadhaar card and ration card with you.',
      'If your name is on the list, your card will be made.',
    ],
  },
};

// Hindi voice input writes English medicine words in Devanagari ("मेडिसिन पेंडिंग है").
const devanagariWord = (pattern: string) =>
  new RegExp(`(?<![\\u0900-\\u097F])(?:${pattern})(?![\\u0900-\\u097F])`, 'gu');
const DEVANAGARI_MEDICINE_WORDING: Array<[RegExp, string]> = [
  [devanagariWord('मेडिसिन(?:्स|ें)?|मेडिसिंस|मेडिकेशन(?:्स)?'), 'दवाई'],
  [devanagariWord('टेबलेट(?:्स)?|टैबलेट्स'), 'टैबलेट'],
  [devanagariWord('पेंडिंग'), 'बाकी'],
  [devanagariWord('मिस(?:्ड)?'), 'छूट'],
  [devanagariWord('शेड्यूल|टाइमिंग|टाइम'), 'समय'],
  [devanagariWord('डोज़?'), 'खुराक'],
];

// Strength words a patient may speak instead of digits ("टेलमा फोर्टी", "पाँच सौ").
const SPOKEN_NUMBERS: Record<string, string> = {
  five: '5',
  ten: '10',
  twenty: '20',
  forty: '40',
  fifty: '50',
  eighty: '80',
  hundred: '×100',
  thousand: '×1000',
  फाइव: '5',
  पांच: '5',
  पाँच: '5',
  टेन: '10',
  दस: '10',
  ट्वेंटी: '20',
  बीस: '20',
  फोर्टी: '40',
  फ़ोर्टी: '40',
  चालीस: '40',
  फिफ्टी: '50',
  पचास: '50',
  एटी: '80',
  अस्सी: '80',
  हंड्रेड: '×100',
  सौ: '×100',
  थाउजेंड: '×1000',
  हज़ार: '×1000',
  हजार: '×1000',
};

const DEVANAGARI_SOUNDS: Record<string, string> = {
  क: 'k',
  ख: 'k',
  ग: 'g',
  घ: 'g',
  च: 'c',
  छ: 'c',
  ज: 'j',
  झ: 'j',
  ट: 't',
  ठ: 't',
  ड: 'd',
  ढ: 'd',
  ण: 'n',
  त: 't',
  थ: 't',
  द: 'd',
  ध: 'd',
  न: 'n',
  प: 'p',
  फ: 'f',
  ब: 'b',
  भ: 'b',
  म: 'm',
  र: 'r',
  ल: 'l',
  व: 'v',
  श: 's',
  ष: 's',
  स: 's',
  'ं': 'n',
};

/**
 * Consonant skeleton used to compare a spoken or misspelt medicine word with
 * its verified name across scripts: "टेलमा" and "Telma" -> "tlm", "metformon"
 * and "मेटफॉर्मिन" -> "mtfrmn". Short skeletons fall back to the exact word.
 */
export function medicineWordKey(word: string): string {
  const lower = word.normalize('NFC').toLocaleLowerCase();
  const skeleton = /[ऀ-ॿ]/u.test(lower)
    ? [
        ...lower
          .replace(/ज़/gu, 'z')
          .replace(/फ़/gu, 'f')
          .replace(/[डढ]़/gu, 'r'),
      ]
        .map((char) =>
          /[a-z]/.test(char) ? char : DEVANAGARI_SOUNDS[char] || '',
        )
        .join('')
    : lower
        .replace(/ph/g, 'f')
        .replace(/sh/g, 's')
        .replace(/ch/g, 'C')
        .replace(/ck/g, 'k')
        .replace(/c(?=[eiy])/g, 's')
        .replace(/c/g, 'k')
        .replace(/C/g, 'c')
        .replace(/q/g, 'k')
        .replace(/x/g, 'ks')
        .replace(/w/g, 'v')
        .replace(/[^a-z]|[aeiouyh]/g, '');
  const collapsed = skeleton.replace(/(.)\1+/g, '$1');
  return collapsed.length >= 3 ? collapsed : `=${lower}`;
}

/** Word keys for medicine matching; spoken strengths become digits. */
function medicineQuestionKeys(value: string): string[] {
  const words = value.toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  const keys: string[] = [];
  for (const word of words) {
    const spoken = SPOKEN_NUMBERS[word];
    const previous = keys[keys.length - 1];
    if (spoken?.startsWith('×')) {
      const factor = Number(spoken.slice(1));
      if (previous && /^\d+$/.test(previous))
        keys[keys.length - 1] = String(Number(previous) * factor);
      else keys.push(String(factor));
    } else if (spoken) keys.push(spoken);
    else keys.push(/^\d+(?:\.\d+)?$/.test(word) ? word : medicineWordKey(word));
  }
  return keys;
}

@Injectable()
export class AiOrchestratorService implements IAiOrchestrator {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    @Inject('IAiProvider') private readonly aiProvider: IAiProvider,
    @Inject('ILanguageProvider')
    private readonly languageProvider: ILanguageProvider,
    @Inject('IIntentClassifier')
    private readonly intentClassifier: IIntentClassifier,
    private readonly agentRouter: AgentRouterService,
    private readonly clinicalContextService: ClinicalContextService,
    @Inject('ISafetyGate') private readonly safetyGate: ISafetyGate,
    private readonly auditService: AuditService,
    private readonly prescriptionSessionContext: PrescriptionSessionContextService,
    @Optional()
    private readonly historyService?: ConversationHistoryService,
    @Optional()
    private readonly responseFormatter?: ConversationResponseFormatter,
    @Optional()
    private readonly knowledgeRetrievalService?: KnowledgeRetrievalService,
    @Optional()
    private readonly knowledgeQueryNormalizer?: KnowledgeQueryNormalizerService,
    @Optional() private readonly facilitySearch?: FacilitySearchService,
    @Optional() private readonly facilityDirectory?: FacilityDirectoryLoader,
    @Optional() private readonly schemeService?: SchemeService,
    @Optional()
    @InjectRepository(Session)
    private readonly sessions?: Repository<Session>,
    @Optional()
    @InjectRepository(Prescription)
    private readonly prescriptions?: Repository<Prescription>,
    @Optional()
    @Inject(PATIENT_DATA_PROVIDER)
    private readonly patientData?: PatientDataProvider,
    @Optional()
    @InjectRepository(ConversationTurn)
    private readonly conversationTurns?: Repository<ConversationTurn>,
    @Optional() private readonly ragEvaluation?: RagEvaluationService,
    @Optional() private readonly tracer?: LangSmithTracerService,
    @Optional() private readonly ragasGate?: RagasVerificationGateService,
    @Optional()
    private readonly terminologyResolver: TerminologyResolverService = new TerminologyResolverService(),
  ) {}

  private triageContent(language: string): Record<string, string> {
    const summary = language.startsWith('hi')
      ? 'माफ़ कीजिए, मैं आपकी बात ठीक से समझ नहीं पाई। कृपया अपना सवाल दोबारा पूछें। आप ब्लड प्रेशर, शुगर, अपनी दवाइयों, स्वास्थ्य सेवाओं या सरकारी स्वास्थ्य योजनाओं के बारे में पूछ सकते हैं।'
      : 'Sorry, I did not understand that. Please ask your question again. You can ask about blood pressure, sugar, your medicines, health services or government health schemes.';
    return { summary, [language]: summary };
  }

  private clinicalDeflectionContent(
    language: string,
    possibleEmergency = false,
    decision: MedicationDecision = 'DOSE',
    inputText = '',
  ): Record<string, unknown> {
    const hindi = language.startsWith('hi');
    const stopAll = STOP_ALL_MEDICINES_MESSAGE[hindi ? 'hi' : 'en'];
    const summary = possibleEmergency
      ? emergencyMessage(inputText, hindi)
      : decision === 'SIDE_EFFECT'
        ? SIDE_EFFECT_MESSAGE[hindi ? 'hi' : 'en']
        : decision === 'STILL_HIGH'
          ? STILL_HIGH_ON_MEDICINES_MESSAGE[hindi ? 'hi' : 'en']
          : decision === 'STOP_ALL' || decision === 'MEDICINE'
            ? stopAll.summary
            : decision === 'CHANGE'
              ? medicineChangeMessage(inputText, hindi)
              : decision === 'GENERAL'
                ? CLINICAL_ADVICE_MESSAGE[hindi ? 'hi' : 'en']
                : MEDICINE_DOSE_MESSAGE[hindi ? 'hi' : 'en'];
    return {
      summary,
      [language]: summary,
      ...(decision === 'STOP_ALL' && !possibleEmergency
        ? { sections: [{ body: stopAll.reminders }] }
        : {}),
      actions: [
        {
          label: hindi ? 'पास का अस्पताल ढूँढें' : 'Find a nearby hospital',
          action: 'FIND_FACILITY',
        },
        {
          label: 'eSanjeevani',
          action: 'OPEN_ESANJEEVANI',
        },
      ],
    };
  }

  // Out of scope: say so plainly, never guess, say what VDA can help with,
  // and point other health questions to the ASHA or health centre.
  private outOfScopeContent(language: string): Record<string, unknown> {
    const summary = language.startsWith('hi')
      ? 'माफ़ कीजिए, इस सवाल का सही जवाब मैं नहीं दे सकती। मैं ब्लड प्रेशर, शुगर, आपकी दवाइयों, स्वास्थ्य सेवाओं और सरकारी स्वास्थ्य योजनाओं के बारे में मदद कर सकती हूँ। सेहत से जुड़े दूसरे सवालों के लिए अपने क्षेत्र की आशा या नज़दीकी स्वास्थ्य केंद्र से पूछें।'
      : 'Sorry, I cannot give a correct answer to this question. I can help with blood pressure, sugar, your medicines, health services and government health schemes. For other health questions, please ask the ASHA worker in your area or your nearest health centre.';
    return { summary, [language]: summary };
  }

  /**
   * Resolves prescription-only references locally. `input` is never forwarded
   * to Gemini: it only selects a minimal subset of the server-held context.
   */
  private resolvePrescriptionContextQuestion(
    context: SanitizedPrescriptionSessionContext | null,
    rawInput: string,
    language: string,
  ): PrescriptionContextResolution | null {
    const input = DEVANAGARI_MEDICINE_WORDING.reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      rawInput,
    );
    const normalized = this.normalizePrescriptionReference(input);
    const asksMissedDose =
      /(?:(?:दवा|दवाई|गोली|खुराक).{0,32}(?:भूल|छूट)|(?:भूल|छूट).{0,32}(?:दवा|दवाई|गोली|खुराक)|\b(?:dawai|dawa|medicine|medication|tablet|pill|dose)\b.{0,40}\b(?:bhool|forgot|miss(?:ed)?|skip(?:ped)?)\b|\b(?:bhool|forgot|miss(?:ed)?|skip(?:ped)?)\b.{0,40}\b(?:dawai|dawa|medicine|medication|tablet|pill|dose)\b)/i.test(
        input,
      );
    const asksDoseAction =
      /(?:\b(?:abhi|now)\b.{0,20}\b(?:le|lu|loon|lena|take)\b|\b(?:do|two|2|double|agli|next)\b.{0,20}\b(?:tablet|pill|dose|khurak|goli|skip|le|lu|take)\b|(?:अभी|अब).{0,20}(?:ले|लूं|लूँ|लेना)|(?:दो|दोगुनी|अगली).{0,20}(?:गोली|खुराक|दवा|छोड़|स्किप|ले|लूं|लूँ))/i.test(
        input,
      );
    const asksTreatmentChange =
      /(?:\b(?:stop|start|increase|decrease|change|adjust|double|band|badhau|badha|ghatau|ghata)\b|बंद|शुरू|बढ़ा|घटा|बदल|दोगुनी)/i.test(
        input,
      );
    const asksWhatToDoAfterMiss =
      /(?:\b(?:ab|now|what)\b.{0,20}\b(?:kya|what|karu|karoon|do|take|skip)\b|(?:अब|तो|फिर).{0,20}(?:क्या\s*करूँ|क्या\s*करूं|ले\s*लूं|ले\s*लूँ|छोड़\s*दूं|स्किप)|\bkya\s*kar(?:u|un|oon|en)\b|क्या\s*कर(?:ूँ|ूं|ें))/i.test(
        input,
      );
    const hasGenericMedicineReference =
      /(?:\b(?:medicines?|medications?|doses?|dosage|tablets?|pills?|dawai|dawa|khurak|goli)\b|दवा|दवाई|गोली|खुराक|टैबलेट)/i.test(
        input,
      );
    const asksNamedTreatmentChange =
      /(?:\b(?:band|start|change|badha|badhau|ghata|ghatau)\s*(?:kar)?\s*(?:du|dun|doon|lu|loon|sakta|sakti)\b|(?:बंद|शुरू|बदल|बढ़ा|घटा)\s*(?:कर)?\s*(?:दूं|दूँ|लूं|लूँ|सकता|सकती))/i.test(
        input,
      );
    const strengthSubstitution =
      /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g)\b.{0,48}\b(?:instead|replace|rather|jagah|badle)\b.{0,48}\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g)\b|\b(?:jagah|badle|instead|replace)\b.{0,48}\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g)\b/i.test(
        input,
      );
    const clinicalMedicationDecision =
      strengthSubstitution ||
      asksDoseAction ||
      (asksMissedDose && asksWhatToDoAfterMiss) ||
      (asksTreatmentChange &&
        (hasGenericMedicineReference || asksNamedTreatmentChange));

    // Treatment authority is decided before prescription availability. A
    // missing or unverified plan can never turn a dose decision into an
    // informational "upload a prescription" response. This local decision
    // also keeps the raw patient question out of external classification.
    if (clinicalMedicationDecision) {
      return {
        kind: 'CLINICAL_MEDICATION_DECISION',
        decision:
          strengthSubstitution ||
          asksDoseAction ||
          (asksMissedDose && asksWhatToDoAfterMiss)
            ? 'DOSE'
            : asksToStopAllMedicines(input)
              ? 'STOP_ALL'
              : 'CHANGE',
      };
    }

    // Adherence is recorded on the patient's device. A prescription lists
    // medicines and times, but cannot establish whether a dose was taken.
    // Keep these intents ahead of the broad prescription-list matcher.
    if (
      /\b(?:galti|galat|accidental(?:ly)?|mistake|wrong)\b.{0,45}\b(?:taken|mark|le\s*li|liya)\b|गलती.{0,45}(?:ले ली|मार्क|दर्ज)/i.test(
        input,
      )
    ) {
      return { kind: 'ADHERENCE_STATUS', question: 'CORRECTION' };
    }
    if (
      /\b(?:streak|lagatar|continuous)\b|लगातार.{0,25}(?:दिन|दवा)|स्ट्रीक/i.test(
        input,
      )
    ) {
      return { kind: 'ADHERENCE_STATUS', question: 'STREAK' };
    }
    if (
      /\b(?:pending|remaining|left to take|baaki|baki)\b|बाकी|लंबित/i.test(
        input,
      ) &&
      hasGenericMedicineReference
    ) {
      return { kind: 'ADHERENCE_STATUS', question: 'PENDING' };
    }
    if (
      (asksMissedDose ||
        (hasGenericMedicineReference &&
          /\b(?:missed|skipped|bhool|chhoot)\b|छूट|भूल/i.test(input))) &&
      /\b(?:show|list|dikhao|kal|yesterday|which|kaunsi|konsi)\b|दिखाओ|कौनसी|कौन\s*सी|कल/i.test(
        input,
      )
    ) {
      return { kind: 'ADHERENCE_STATUS', question: 'MISSED' };
    }
    if (
      /\b(?:refill|run(?:ning)? out|finished|khatam|stock)\b|खत्म|समाप्त/i.test(
        input,
      ) &&
      hasGenericMedicineReference
    ) {
      return { kind: 'REFILL_SUPPORT' };
    }

    const statusQuestion =
      /(?:\b(?:prescription|parchi)\b|पर्ची).{0,40}(?:\b(?:status|verify|verified|verification|approved|reviewed|check|pending)\b|स्थिति|जाँच|जांच|सत्यापित|मंजूर|मंज़ूर)|(?:\b(?:status|verification)\b|स्थिति).{0,35}(?:\b(?:prescription|parchi)\b|पर्ची)|^(?:my\s+prescription|meri\s+parchi|मेरी\s+पर्ची)[?.!]*$/i.test(
        input.trim(),
      );
    if (statusQuestion) return { kind: 'PRESCRIPTION_STATUS' };
    const genericMedicine =
      /(?:\b(?:my|meri|mera|mere|show|list|batao|dikhao)\b.{0,35}\b(?:medicine|medicines|medication|medications|dawa|dawai|dawain|dawaiyan)\b|\b(?:medicine|medicines|medication|medications|dawa|dawai|dawain|dawaiyan)\b.{0,30}\b(?:schedule|routine|timing|time|kab|list|show|batao|dikhao)\b|मेरी?\s*दवा(?:इ|ई)?(?:यां|याँ|यों|ओं|एं|एँ)?|दवा(?:इ|ई)?(?:यां|याँ|यों|ओं|एं|एँ)?.{0,20}(?:समय|कब|दिखा|बताओ))/i.test(
        input,
      );
    const genericTiming =
      /(?:\b(?:schedule|routine|timing|time|kab|samay)\b|समय|कब)/i.test(input);
    const genericList =
      genericMedicine ||
      /(?:आज\s*की|aaj\s*ki|today(?:'s)?)\s*(?:दवा|दवाई|दवाइयाँ|dawa|dawai|medicines?)/i.test(
        input,
      ) ||
      /\bwhat\s+(?:medicines|medications)\s+am\s+i\s+taking\b/i.test(input) ||
      /^(?:my\s+)?(?:medicine|medicines|medication|medications|dawa|dawai|दवा|दवाई)(?:\s+(?:please|बताओ|दिखाओ))?\s*[?.!]*$/i.test(
        input.trim(),
      );
    if (
      !context ||
      (!context.medicines.length && !context.investigations.length)
    ) {
      if (genericList)
        return { kind: genericTiming ? 'REMINDER_FACT' : 'MEDICINE_LIST' };
      return null;
    }
    const mentions = <T extends { name: string }>(items: T[]): T | undefined =>
      items.find((item) =>
        normalized.includes(this.normalizePrescriptionReference(item.name)),
      );
    const refers =
      /(?:\b(?:ye|yeh|this|it|iski|iska|iske)\b|इसे|इसकी|इसका|इसके|ये|यह)/i.test(
        input,
      );
    const medicineMatches = this.matchVerifiedMedicines(
      context.medicines,
      input,
    );
    // A short brand may refer to multiple verified products or strengths.
    // Show the verified list so the patient can name the exact one.
    if (medicineMatches.length > 1) return { kind: 'MEDICINE_LIST' };
    const medicine =
      medicineMatches[0] ||
      (refers && context.lastReferencedMedicine
        ? context.medicines.find(
            (item) => item.name === context.lastReferencedMedicine,
          )
        : undefined);
    const investigation =
      mentions(context.investigations) ||
      (refers && context.lastReferencedInvestigation
        ? context.investigations.find(
            (item) => item.name === context.lastReferencedInvestigation,
          )
        : undefined);
    const isReminder = /(?:reminder|रिमाइंडर)/i.test(input);
    const asksTiming =
      /(?:\b(?:kab|when|samay)\b|कब\s*(?:लेना|लेनी|लूं|लूँ|लें|है|होगा)|कितने बजे|timing|time|समय)/i.test(
        input,
      );
    const asksMedicineSpecificDoseSafety = Boolean(
      medicine && (asksDoseAction || asksTreatmentChange),
    );
    const asksList =
      genericList ||
      /(?:कौन\s*सी\s*दवा|कौनसी\s*दवाई|meri\s*(?:kaunsi|konsi)\s*(?:dawai|medicine)|my\s*medicines|medicines?\s*(?:are|in))/i.test(
        input,
      );
    const asksTestList =
      /(?:कौन\s*सा\s*(?:test|टेस्ट|जांच)|kaunsa\s*(?:test|investigation)|which\s*(?:test|investigation)|prescription.*(?:test|जांच)|(?:test|जांच).*(?:prescription|पर्ची))/i.test(
        input,
      );
    const asksGeneralUse =
      /(?:किस\s*(?:लिए|काम)|kis\s*(?:liye|liye)|क्या\s*(?:करती|करता|है)|kya\s*(?:karti|karta)|what\s*(?:does|is)|why\s*(?:is|was)|use\s*(?:करते|करती|hoti|hota|hai)|काम\s*(?:की|का|है)|side\s*effects?|नुकसान)/i.test(
        input,
      );
    const asksBpMedicine =
      /(?:\b(?:bp|blood\s*pressure)\b|बीपी|ब्लड प्रेशर).*(?:दवा|दवाई|medicine)|(?:दवा|दवाई|medicine).*(?:\b(?:bp|blood\s*pressure)\b|बीपी|ब्लड प्रेशर)/i.test(
        input,
      );

    if ((asksMedicineSpecificDoseSafety || asksTreatmentChange) && medicine) {
      return {
        kind: 'CLINICAL_MEDICATION_DECISION',
        decision: asksDoseAction ? 'DOSE' : 'CHANGE',
      };
    }
    if (isReminder || (genericList && genericTiming))
      return { kind: 'REMINDER_FACT', medicine };
    if (asksTiming && !medicine && genericList && context.medicines.length > 0)
      return { kind: 'REMINDER_FACT' };
    if (asksTestList) return { kind: 'INVESTIGATION_LIST' };
    if (investigation && asksGeneralUse) {
      return {
        kind: 'INVESTIGATION_EDUCATION',
        investigation,
        question: language.startsWith('hi')
          ? 'यह जांच आम तौर पर क्या मापती है? सरल हिंदी में समझाएं।'
          : 'What does this test generally measure? Explain simply.',
      };
    }
    if (asksBpMedicine && context.medicines.length > 0) {
      return {
        kind: 'MEDICINE_FOR_BP',
        medicines: context.medicines,
        question: language.startsWith('hi')
          ? 'इनमें से कौन-सी दवा आम तौर पर ब्लड प्रेशर नियंत्रित करने के लिए इस्तेमाल होती है? किसी व्यक्तिगत निदान का अनुमान न लगाएं।'
          : 'Which listed medicine is commonly used for blood-pressure control? Do not infer a personal diagnosis.',
      };
    }
    if (medicine && asksGeneralUse) {
      return {
        kind: 'MEDICINE_EDUCATION',
        medicine,
        question: language.startsWith('hi')
          ? 'यह दवा आम तौर पर किस लिए इस्तेमाल की जाती है? सरल हिंदी में समझाएं।'
          : 'What is this medicine commonly used for? Explain simply.',
      };
    }
    if (medicine && asksTiming) return { kind: 'MEDICINE_FACT', medicine };
    if (asksList) return { kind: 'MEDICINE_LIST' };
    if (medicine) return { kind: 'MEDICINE_FACT', medicine };
    return null;
  }

  private prescriptionContextDirectContent(
    context: SanitizedPrescriptionSessionContext,
    resolution: Extract<
      PrescriptionContextResolution,
      {
        kind:
          | 'MEDICINE_LIST'
          | 'MEDICINE_FACT'
          | 'REMINDER_FACT'
          | 'INVESTIGATION_LIST';
      }
    >,
    language: string,
  ): Record<string, unknown> {
    const hindi = language.startsWith('hi');
    if (resolution.kind === 'MEDICINE_LIST') {
      const bullets = context.medicines.map((medicine) =>
        this.patientPrescriptionMedicineLine(medicine, hindi),
      );
      const summary = hindi
        ? 'आपकी अभी सेव की हुई पर्ची में ये दवाइयाँ लिखी हैं:'
        : 'Your currently saved prescription lists these medicines:';
      const closing = hindi
        ? 'अगर आप चाहें, तो मैं आपकी दवाइयों के सही समय पर आपको याद दिला सकती हूँ।'
        : 'If you would like, I can remind you when it is time to take your medicines.';
      return {
        summary,
        [language]: summary,
        sections: [
          {
            title: hindi ? 'पर्ची की दवाइयाँ' : 'Prescription medicines',
            bullets,
          },
          { body: closing },
        ],
      };
    }
    if (resolution.kind === 'INVESTIGATION_LIST') {
      const bullets = context.investigations.map((item) => item.name);
      const summary = bullets.length
        ? hindi
          ? 'आपकी सेव की हुई पर्ची में ये जांचें लिखी हैं:'
          : 'Your saved prescription lists these tests:'
        : hindi
          ? 'आपकी सेव की हुई पर्ची में कोई जांच नहीं लिखी है।'
          : 'No tests are listed in your saved prescription.';
      return {
        summary,
        [language]: summary,
        ...(bullets.length
          ? {
              sections: [
                {
                  title: hindi ? 'जांचें' : 'Tests',
                  bullets,
                },
              ],
            }
          : {}),
      };
    }
    if (resolution.kind === 'MEDICINE_FACT') {
      const medicine = resolution.medicine;
      const bullets = [
        `${hindi ? 'पर्ची के अनुसार कितनी बार' : 'Prescribed frequency'}: ${this.patientPrescriptionFrequency(medicine.frequency, hindi) || (hindi ? 'दर्ज नहीं' : 'not recorded')}`,
        `${hindi ? 'पर्ची में लिखा समय' : 'Prescribed timing'}: ${this.patientPrescriptionTiming(medicine.timingInstruction, hindi) || (hindi ? 'दर्ज नहीं' : 'not recorded')}`,
      ];
      const reminders = context.reminders.filter(
        (item) =>
          this.normalizePrescriptionReference(item.medicineName) ===
          this.normalizePrescriptionReference(medicine.name),
      );
      if (reminders.length)
        bullets.push(
          `${hindi ? 'फ़ोन पर सेव रिमाइंडर' : 'Device reminder'}: ${reminders
            .flatMap((item) => item.reminderTimes)
            .map((time) => this.patientReminderTime(time, hindi))
            .join(', ')}`,
        );
      const summary = hindi
        ? `${medicine.name} के बारे में आपकी पर्ची और फ़ोन में यह लिखा है:`
        : `Recorded prescription and phone information for ${medicine.name}:`;
      return {
        summary,
        [language]: summary,
        sections: [
          {
            title: hindi
              ? 'पर्ची में लिखी जानकारी'
              : 'Prescription information',
            bullets,
          },
        ],
      };
    }
    const reminders = resolution.medicine
      ? context.reminders.filter(
          (item) =>
            this.normalizePrescriptionReference(item.medicineName) ===
            this.normalizePrescriptionReference(resolution.medicine!.name),
        )
      : context.reminders;
    const bullets = reminders.map(
      (item) =>
        `${item.medicineName}: ${item.reminderTimes.map((time) => this.patientReminderTime(time, hindi)).join(', ')}`,
    );
    const summary = bullets.length
      ? hindi
        ? 'आपके सेव किए हुए रिमाइंडर:'
        : 'Your saved reminders:'
      : context.remindersUnavailable
        ? hindi
          ? 'आपकी दवाइयाँ मंज़ूर हैं, पर रिमाइंडर का समय अभी यहाँ नहीं दिख रहा। “दवाइयाँ” वाला हिस्सा खोलें।'
          : 'Your medicines are verified, but saved reminder times are unavailable here right now. Open Medicines to sync them.'
        : resolution.medicine
          ? hindi
            ? 'यह दवा मंज़ूर है, पर इसके रिमाइंडर का समय अभी नहीं चुना गया है।'
            : 'This medicine is verified, but no reminder time has been selected for it yet.'
          : hindi
            ? 'आपकी दवाइयाँ मंज़ूर हैं, पर आपने अभी रिमाइंडर का समय नहीं चुना है।'
            : 'Your medicines are verified, but you have not selected reminder times yet.';
    return {
      summary,
      [language]: summary,
      ...(bullets.length
        ? {
            sections: [
              { title: hindi ? 'दवा रिमाइंडर' : 'Medicine reminders', bullets },
            ],
          }
        : {}),
    };
  }

  /**
   * Card-application answers list the centre route and the online route.
   * When the generated answer could not be verified, the approved fixed
   * in-person steps replace the "no reliable answer" message.
   */
  private withBothCardApplicationRoutes(
    content: Record<string, any>,
    hindi: boolean,
    replaceUnverified: boolean,
    seniorCard = false,
  ): Record<string, any> {
    const online = AYUSHMAN_ONLINE_SECTION[hindi ? 'hi' : 'en'];
    // Vay Vandana (70+) questions also get NHA's how-to video, on screen only.
    const extra = seniorCard
      ? [{ ...VAY_VANDANA_VIDEO[hindi ? 'hi' : 'en'] }]
      : [];
    // 70+ cards need only Aadhaar (NHA senior-citizen FAQ), unlike the
    // ration-card route the general guidelines describe, so they always get
    // the fixed senior answer.
    if (replaceUnverified || seniorCard) {
      const inPerson = (
        seniorCard ? VAY_VANDANA_IN_PERSON_ANSWER : AYUSHMAN_IN_PERSON_ANSWER
      )[hindi ? 'hi' : 'en'];
      return {
        summary: inPerson.summary,
        sections: [
          { title: inPerson.title, bullets: inPerson.bullets },
          { ...online },
          ...extra,
        ],
      };
    }
    const sections = Array.isArray(content.sections) ? content.sections : [];
    if (sections.some((section) => section?.body === online.body))
      return content;
    return { ...content, sections: [...sections, { ...online }, ...extra] };
  }

  private normalizePrescriptionReference(value: string): string {
    return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  private matchVerifiedMedicines(
    items: SanitizedPrescriptionMedicine[],
    input: string,
  ): SanitizedPrescriptionMedicine[] {
    const question = medicineQuestionKeys(input);
    const findSequence = (sequence: string[]) =>
      sequence.length
        ? question.findIndex((_, start) =>
            sequence.every((word, offset) => question[start + offset] === word),
          )
        : -1;
    // Full names take precedence over short brand mentions. A requested number
    // must agree with the verified name, so "Telma 80" cannot select Telma 40.
    const full = items.filter(
      (item) => findSequence(medicineQuestionKeys(item.name)) >= 0,
    );
    if (full.length) return full;
    const brandWords = (item: SanitizedPrescriptionMedicine) =>
      medicineQuestionKeys(item.name).filter(
        (word) =>
          !/^\d+(?:\.\d+)?$/.test(word) && !/^=(?:mg|mcg|ml|g|iu)$/.test(word),
      );
    const mentionedWithoutOtherStrength = (sequence: string[]) => {
      const start = findSequence(sequence);
      return (
        start >= 0 &&
        !/^\d+(?:\.\d+)?$/.test(question[start + sequence.length] || '')
      );
    };
    const brands = items.filter((item) =>
      mentionedWithoutOtherStrength(brandWords(item)),
    );
    if (brands.length) return brands;
    // Spoken Hindi often drops a short suffix ("ओज़ोमेट" for Ozomet VG 2), so a
    // distinctive first brand word may select the medicine on its own.
    return items.filter((item) => {
      const first = brandWords(item)[0];
      return Boolean(
        first &&
        !first.startsWith('=') &&
        mentionedWithoutOtherStrength([first]),
      );
    });
  }

  /** A named medicine was not found: show what the verified prescription does list. */
  private unmatchedPrescriptionContent(
    context: SanitizedPrescriptionSessionContext | null,
    language: string,
  ): Record<string, unknown> {
    const hindi = language.startsWith('hi');
    const bullets = (context?.medicines || []).map((medicine) =>
      this.patientPrescriptionMedicineLine(medicine, hindi),
    );
    const summary = !context
      ? hindi
        ? 'अभी आपकी कोई सेव की हुई पर्ची नहीं है। दवाइयों या जांच की जानकारी के लिए कृपया अपनी पर्ची अपलोड करें।'
        : 'You do not have a saved prescription yet. Please upload one for medicine or test information.'
      : bullets.length
        ? hindi
          ? 'यह नाम आपकी पर्ची में नहीं मिला। आपकी पर्ची में ये दवाइयाँ हैं:'
          : 'I could not find that name in your prescription. Your prescription has these medicines:'
        : hindi
          ? 'यह दवा या जांच आपकी अभी सेव की हुई पर्ची में नहीं मिली। कृपया पर्ची में लिखा नाम जांचें।'
          : 'This medicine or test is not in your currently saved prescription. Please check the name on the prescription.';
    return {
      summary,
      [language]: summary,
      ...(bullets.length ? { sections: [{ bullets }] } : {}),
    };
  }

  private patientReminderTime(value: string, hindi: boolean): string {
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
    const part =
      hours < 12
        ? hindi
          ? 'सुबह'
          : 'morning'
        : hours < 17
          ? hindi
            ? 'दोपहर'
            : 'afternoon'
          : hindi
            ? 'शाम'
            : 'evening';
    const hour = hours % 12 || 12;
    return hindi
      ? `${part} ${hour}:${String(minutes).padStart(2, '0')} बजे`
      : `${hour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
  }

  private patientPrescriptionMedicineLine(
    medicine: SanitizedPrescriptionMedicine,
    hindi: boolean,
  ): string {
    const strength = this.patientPrescriptionStrength(medicine.strength);
    const name = [medicine.name, strength].filter(Boolean).join(' ');
    const details = [
      this.patientPrescriptionFrequency(medicine.frequency, hindi),
      this.patientPrescriptionTiming(medicine.timingInstruction, hindi),
      medicine.administrationInstruction,
    ].filter((value): value is string => Boolean(value));
    return details.length
      ? `${name} — ${[...new Set(details)].join(' • ')}`
      : name;
  }

  private patientPrescriptionStrength(value?: string): string | undefined {
    if (!value?.trim()) return undefined;
    const normalized = value
      .trim()
      .replace(/(\d)\s*(mg|mcg|g|ml|iu)\b/i, '$1 $2');
    // A unitless number such as "40" is ambiguous and must not be shown as a dose.
    return /^\d+(?:\.\d+)?$/.test(normalized) ? undefined : normalized;
  }

  private patientPrescriptionFrequency(
    value: string | undefined,
    hindi: boolean,
  ): string | undefined {
    if (!value?.trim()) return undefined;
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ');
    if (/^(?:od|daily|once daily|once a day|1 time daily)$/.test(normalized)) {
      return hindi ? 'दिन में 1 बार' : 'once daily';
    }
    if (/^(?:bd|bid|twice daily|twice a day|2 times daily)$/.test(normalized)) {
      return hindi ? 'दिन में 2 बार' : 'twice daily';
    }
    if (
      /^(?:tds|tid|thrice daily|three times daily|3 times daily)$/.test(
        normalized,
      )
    ) {
      return hindi ? 'दिन में 3 बार' : 'three times daily';
    }
    return value.trim();
  }

  private patientPrescriptionTiming(
    value: string | undefined,
    hindi: boolean,
  ): string | undefined {
    if (!value?.trim()) return undefined;
    const normalized = value.trim().toLowerCase();
    if (/^(?:morning|सुबह)$/.test(normalized))
      return hindi ? 'सुबह' : 'morning';
    if (/^(?:afternoon|दोपहर)$/.test(normalized))
      return hindi ? 'दोपहर' : 'afternoon';
    if (/^(?:evening|शाम)$/.test(normalized)) return hindi ? 'शाम' : 'evening';
    if (/^(?:night|bedtime|रात)$/.test(normalized))
      return hindi ? 'रात' : 'night';
    return value.trim();
  }

  private async facilityLocation(
    sessionId: string,
    input: string,
    language: string,
  ): Promise<{
    state?: string;
    district?: string;
    city?: string;
    locality?: string;
  }> {
    const current: { state?: string; district?: string } =
      this.knowledgeQueryNormalizer?.normalize(
        input,
        language,
        IntentType.FACILITY_QUERY,
      ) || {};
    let state = current.state;
    let district = current.district;

    if ((!state || !district) && this.sessions && this.patientData) {
      const session = await this.sessions.findOne({ where: { id: sessionId } });
      if (session) {
        const patient = await this.patientData.getPatientByReference(
          session.tenantId,
          session.subjectAbhaRef,
        );
        if (patient) {
          if (!state && patient.state) state = patient.state;
          if (!district && patient.district) district = patient.district;
        }
      }
    }

    // An old conversation location must not override the updated profile.
    if ((!state || !district) && this.conversationTurns) {
      const history = await this.conversationTurns.find({
        where: { sessionId, conversationRetentionGranted: true },
        order: { createdAt: 'DESC' },
        take: 5,
      });
      for (const turn of history) {
        if (!turn.inputText) continue;
        const prior = this.knowledgeQueryNormalizer?.normalize(
          turn.inputText,
          language,
          IntentType.FACILITY_QUERY,
        );
        if (!state && prior?.state) state = prior.state;
        if (!district && prior?.district) district = prior.district;
        if (state && district) break;
      }
    }

    return { state, district };
  }

  /**
   * Adapts the read-only NHA pilot directory to the existing facility response
   * contract. These are transient objects only: no facility entity, overlay,
   * scheme association, or service capability is persisted or inferred.
   */
  private directoryFacilityResults(
    entries: FacilityDirectoryEntry[],
  ): FacilitySearchResult[] {
    const source = this.facilityDirectory?.source();
    return entries.map((entry) => ({
      facility: {
        id: `directory:${entry.facilityId}`,
        tenantId: '',
        facilityId: entry.facilityId,
        name: entry.name,
        state: entry.state,
        district: entry.district,
        city: entry.city,
        address: entry.address,
        contactNumber: entry.contact,
        // Ownership is a source fact used only for display in this transient
        // directory result; generic DB filtering remains unchanged.
        hospitalType:
          entry.ownership === 'GOVERNMENT' ? 'Government' : 'Private',
        pmjayStatus: /^pm-?jay$/i.test(entry.scheme || ''),
        latitude: entry.latitude == null ? null : String(entry.latitude),
        longitude: entry.longitude == null ? null : String(entry.longitude),
        // NHA speciality labels are not service-capability evidence and must
        // not be matched to a requested diagnostic service.
        specialityCodes: [],
        sourceDocumentId: null,
        sourceVersion: source?.version || 'Unknown',
        sourceUrl: null,
        active: true,
      } as unknown as Facility,
      schemes: entry.scheme ? [entry.scheme] : [],
      iphsOverlay: {
        tenantId: '',
        facilityId: `directory:${entry.facilityId}`,
        state: entry.state.toUpperCase().replace(/\s+/g, '_'),
        iphsLevel: entry.iphsLevel,
        iphsClassification:
          entry.iphsLevel === 'CHC' ? 'CHC_NOT_SUBCLASSIFIED' : entry.iphsLevel,
        iphsServices: { status: 'NOT_VERIFIED', services: [] },
        emergencyCapability: 'UNKNOWN',
        referralLevel:
          entry.iphsLevel === 'DH'
            ? 'DISTRICT'
            : entry.iphsLevel === 'CHC' || entry.iphsLevel === 'SDH'
              ? 'SECONDARY'
              : entry.iphsLevel === 'UNKNOWN'
                ? 'UNKNOWN'
                : 'PRIMARY',
        iphsSource: source?.source || 'NHA PM-JAY facility directory',
        iphsVerified: false,
        classificationBasis: `sourceDirectory.iphsLevel:${entry.iphsLevel}`,
        active: true,
      } as unknown as FacilitySearchResult['iphsOverlay'],
      demoCapabilities: [],
      distanceKm: null,
      travelTimeMinutes: null,
    }));
  }

  private facilityContent(
    results: FacilitySearchResult[],
    location: {
      state?: string;
      district?: string;
      city?: string;
      locality?: string;
    },
    language: string,
    scheme?: string,
    emergency = false,
    serviceContext?: FacilityServiceContext,
  ): Record<string, any> {
    const scope =
      location.locality || location.district || location.city || location.state;
    const normalizedMatchedValues = new Set(
      (serviceContext?.matchedSourceValues || []).map((value) =>
        value.trim().toLocaleLowerCase('en-IN'),
      ),
    );
    const matchedDemoCapabilities = results.flatMap(({ demoCapabilities }) =>
      demoCapabilities.filter(
        (capability) =>
          normalizedMatchedValues.has(
            capability.serviceCode.trim().toLocaleLowerCase('en-IN'),
          ) ||
          normalizedMatchedValues.has(
            capability.serviceName.trim().toLocaleLowerCase('en-IN'),
          ),
      ),
    );
    const matchedDemoFacilityIds = new Set(
      results
        .filter(({ demoCapabilities }) =>
          demoCapabilities.some(
            (capability) =>
              normalizedMatchedValues.has(
                capability.serviceCode.trim().toLocaleLowerCase('en-IN'),
              ) ||
              normalizedMatchedValues.has(
                capability.serviceName.trim().toLocaleLowerCase('en-IN'),
              ),
          ),
        )
        .map(({ facility }) => facility.id),
    );
    const matchedSourceFacilityIds = new Set(
      results
        .filter(({ facility }) =>
          [
            ...(facility.supportedServices || []),
            ...(facility.specialityCodes || []),
          ].some(
            (value) =>
              typeof value === 'string' &&
              normalizedMatchedValues.has(
                value.trim().toLocaleLowerCase('en-IN'),
              ),
          ),
        )
        .map(({ facility }) => facility.id),
    );
    const usesDemoCapability = matchedDemoFacilityIds.size > 0;
    const hasFacilitySpecificServiceEvidence =
      matchedSourceFacilityIds.size > 0;
    const hasMixedServiceEvidence =
      (matchedSourceFacilityIds.size > 0 &&
        matchedSourceFacilityIds.size < results.length) ||
      (matchedDemoFacilityIds.size > 0 &&
        matchedDemoFacilityIds.size < results.length);
    const unmatchedFacilityCount = results.filter(
      ({ facility }) =>
        !matchedSourceFacilityIds.has(facility.id) &&
        !matchedDemoFacilityIds.has(facility.id),
    ).length;
    // Facility-specific records and demo mappings are tracked per result.
    // IPHS level alignment remains a valid recommendation when that facility
    // has no separate service-specific record. Levels are only resolved from
    // verified IPHS evidence (see the facility branch of orchestrateTurn).
    const hasResolvedFacilityLevel =
      (serviceContext?.appropriateIphsLevels.length || 0) > 0;
    const hi = language.startsWith('hi');
    const place = scope || (hi ? 'आपके इलाके' : 'your area');
    const service = serviceContext?.requestedService;
    const callFirst = hi
      ? 'जाने से पहले अस्पताल को फ़ोन करके पूछ लें।'
      : 'Please call the hospital before you go.';
    // Availability at a named facility is never claimed, whatever the evidence.
    const notSure = hi
      ? `अभी ${service} होता है या नहीं, यह पक्का नहीं है।`
      : `I do not know if they offer ${service} right now.`;
    const lowCostNotice = serviceContext?.lowCostPreference
      ? hi
        ? `आपने कम खर्च पूछा था, इसलिए सरकारी और आयुष्मान योजना वाले अस्पताल पहले दिखाए हैं। ${service} का खर्च अस्पताल से पूछ लें।`
        : `You asked for low cost, so government and Ayushman scheme hospitals are shown first. Ask the hospital about the ${service} cost.`
      : '';
    const summary = serviceContext
      ? results.length
        ? usesDemoCapability && matchedDemoFacilityIds.size === results.length
          ? hi
            ? `${place} में ${service} के ये नाम सिर्फ़ पायलट की जानकारी हैं, पक्के नहीं। ${callFirst}`
            : `These ${service} results in ${place} are pilot data only, not confirmed. ${callFirst}`
          : hasMixedServiceEvidence
            ? [
                matchedSourceFacilityIds.size
                  ? hi
                    ? `कुछ अस्पतालों के रिकॉर्ड में ${service} लिखा है।`
                    : `Some hospital records list ${service}.`
                  : '',
                matchedDemoFacilityIds.size
                  ? hi
                    ? 'कुछ नाम सिर्फ़ पायलट की जानकारी से हैं, पक्के नहीं।'
                    : 'Some names come only from pilot data and are not confirmed.'
                  : '',
                unmatchedFacilityCount
                  ? hi
                    ? `सरकारी मानकों के अनुसार, बाकी अस्पतालों में ${service} की सुविधा मिल सकती है।`
                    : `As per government standards, the others may offer ${service}.`
                  : '',
                notSure,
                callFirst,
                lowCostNotice,
              ]
                .filter(Boolean)
                .join(' ')
            : hasFacilitySpecificServiceEvidence
              ? hi
                ? `${place} में इन अस्पतालों के रिकॉर्ड में ${service} लिखा है। ${callFirst}`
                : `Records for these hospitals in ${place} list ${service}. ${callFirst}`
              : hasResolvedFacilityLevel
                ? [
                    // Clinical review standard message 10 ("सरकारी मानक" = IPHS).
                    hi
                      ? `सरकारी मानकों के अनुसार, ${place} के इन अस्पतालों में ${service} की सुविधा मिल सकती है। कृपया जाने से पहले सुविधा उपलब्ध होने की पुष्टि कर लें।`
                      : `As per government standards, these hospitals in ${place} may offer ${service}. Please confirm ${service} is available before you go.`,
                    lowCostNotice,
                  ]
                    .filter(Boolean)
                    .join(' ')
                : [
                    hi
                      ? `${place} में ये अस्पताल आपके पास हैं।`
                      : `These hospitals are near you in ${place}.`,
                    notSure,
                    callFirst,
                  ].join(' ')
        : serviceContext.iphsEvidenceStatus === 'UNAVAILABLE'
          ? hi
            ? 'अभी अस्पतालों की जानकारी नहीं मिल पाई। कृपया थोड़ी देर बाद दोबारा कोशिश करें।'
            : 'I could not get hospital information right now. Please try again in a little while.'
          : hasResolvedFacilityLevel
            ? hi
              ? `${place} में ${service} के लिए सही अस्पताल नहीं मिला। आप पास का कोई दूसरा ज़िला बता सकते हैं।`
              : `I could not find the right hospital for ${service} in ${place}. You can tell me another nearby district.`
            : hi
              ? `${place} में ${service} की जानकारी नहीं मिली। जाने से पहले पास के अस्पताल से पूछ लें।`
              : `I could not find ${service} information for ${place}. Please ask a nearby hospital before you go.`
      : results.length
        ? hi
          ? `${place} में ये अस्पताल हैं। योजना से इलाज मिलेगा या नहीं, यह अस्पताल में पूछना होगा।`
          : `These hospitals are in ${place}. Ask the hospital whether your scheme covers your treatment.`
        : hi
          ? `मुझे ${place}${scheme ? ` में ${scheme}` : ''} के लिए कोई अस्पताल नहीं मिला। आप दूसरा ज़िला बता सकते हैं।`
          : `I could not find a hospital for ${place}${scheme ? ` and ${scheme}` : ''}. You can tell me another district.`;
    const emergencyConfirmed = results.some(
      ({ facility, iphsOverlay }) =>
        iphsOverlay?.emergencyCapability === 'SOURCE_REPORTED_CAPABLE' ||
        facility.emergencyAvailable === true,
    );
    const finalSummary =
      emergency && results.length
        ? `${summary} ${
            emergencyConfirmed
              ? hi
                ? 'जिन अस्पतालों में इमरजेंसी सुविधा दर्ज है, वे पहले दिखाए हैं।'
                : 'Hospitals with emergency care in their records are shown first.'
              : hi
                ? 'इन अस्पतालों में इमरजेंसी सुविधा पक्की नहीं है।'
                : 'Emergency care at these hospitals is not confirmed.'
          }`
        : summary;
    // Three nearby places keep the spoken answer short; facility_results keeps all.
    const cards = results
      .slice(0, 3)
      .map(({ facility, schemes, travelTimeMinutes, distanceKm }) => {
        const government = /government|public|goi/i.test(
          facility.hospitalType || '',
        );
        const evidence = !serviceContext
          ? null
          : matchedDemoFacilityIds.has(facility.id)
            ? hi
              ? 'पायलट जानकारी, पक्की नहीं'
              : 'Pilot data, not confirmed'
            : matchedSourceFacilityIds.has(facility.id)
              ? hi
                ? `रिकॉर्ड में ${service} लिखा है`
                : `Records list ${service}`
              : hasResolvedFacilityLevel
                ? hi
                  ? `${service} के लिए सही स्तर`
                  : `Right level for ${service}`
                : hi
                  ? 'आपके इलाके में'
                  : 'Near your area';
        const area = [
          facility.locality || facility.city,
          facility.district,
          facility.state,
        ]
          .filter((part): part is string => Boolean(part))
          .filter(
            (part, index, parts) =>
              parts.findIndex(
                (other) =>
                  other.toLocaleLowerCase() === part.toLocaleLowerCase(),
              ) === index,
          )
          .join(', ');
        return {
          title: facility.name,
          value: area,
          subtitle: [
            hi
              ? government
                ? 'सरकारी अस्पताल'
                : 'प्राइवेट अस्पताल'
              : government
                ? 'Government hospital'
                : 'Private hospital',
            ...schemes.map((item) =>
              /^(?:pm-?jay|ayushman_bharat)$/i.test(item)
                ? hi
                  ? 'आयुष्मान योजना में शामिल'
                  : 'Part of Ayushman Bharat (PM-JAY)'
                : item.replace(/_/g, ' '),
            ),
            evidence,
            distanceKm != null
              ? hi
                ? `${distanceKm} km दूर`
                : `${distanceKm} km away`
              : null,
            travelTimeMinutes != null
              ? hi
                ? `${travelTimeMinutes} मिनट`
                : `${travelTimeMinutes} min`
              : null,
            facility.contactNumber
              ? `${hi ? 'फ़ोन' : 'Phone'}: ${facility.contactNumber}`
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
        };
      });
    return {
      summary: finalSummary,
      [language]: finalSummary,
      cards,
      facility_results: results.map(
        ({
          facility,
          schemes,
          iphsOverlay,
          demoCapabilities,
          distanceKm,
          travelTimeMinutes,
        }) => ({
          name: facility.name,
          state: facility.state,
          district: facility.district,
          locality: facility.locality,
          hospitalType: facility.hospitalType,
          schemes,
          specialityCodes: facility.specialityCodes,
          supportedServices: facility.supportedServices,
          contactNumber: facility.contactNumber,
          emergencyAvailable: facility.emergencyAvailable,
          distanceKm,
          travelTimeMinutes,
          iphsLevel: iphsOverlay?.iphsLevel || 'UNKNOWN',
          iphsClassification: iphsOverlay?.iphsClassification || 'UNKNOWN',
          iphsServices: iphsOverlay?.iphsServices || {
            status: 'NOT_VERIFIED',
            services: [],
          },
          emergencyCapability: iphsOverlay?.emergencyCapability || 'UNKNOWN',
          referralLevel: iphsOverlay?.referralLevel || 'UNKNOWN',
          iphsSource: iphsOverlay?.iphsSource || null,
          iphsVerified: iphsOverlay?.iphsVerified || false,
          source: facility.sourceVersion || 'Structured facility source',
          matchedSourceServices: serviceContext
            ? [
                ...(facility.supportedServices || []),
                ...(facility.specialityCodes || []),
                ...demoCapabilities.flatMap((capability) => [
                  capability.serviceCode,
                  capability.serviceName,
                ]),
              ].filter((value) =>
                serviceContext.matchedSourceValues.some(
                  (matched) =>
                    matched.trim().toLocaleLowerCase('en-IN') ===
                    value.trim().toLocaleLowerCase('en-IN'),
                ),
              )
            : undefined,
          demoCapabilityProvenance: serviceContext
            ? demoCapabilities
                .filter(
                  (capability) =>
                    normalizedMatchedValues.has(
                      capability.serviceCode.trim().toLocaleLowerCase('en-IN'),
                    ) ||
                    normalizedMatchedValues.has(
                      capability.serviceName.trim().toLocaleLowerCase('en-IN'),
                    ),
                )
                .map((capability) => ({
                  facilityId: capability.facilityId,
                  state: capability.state,
                  district: capability.district,
                  areaLocality: capability.areaLocality,
                  serviceCode: capability.serviceCode,
                  serviceName: capability.serviceName,
                  availability: capability.availability,
                  sourceType: capability.sourceType,
                  source: capability.source,
                  verified: capability.verified,
                  demoOnly: capability.demoOnly,
                  classificationBasis: capability.classificationBasis,
                }))
            : undefined,
        }),
      ),
      requestedService: serviceContext?.requestedService,
      serviceAvailability: serviceContext
        ? matchedDemoFacilityIds.size === results.length && results.length > 0
          ? 'DEMO_PILOT_NOT_VERIFIED'
          : matchedSourceFacilityIds.size === results.length &&
              results.length > 0
            ? 'SOURCE_VERIFIED'
            : 'NOT_VERIFIED'
        : undefined,
      appropriateIphsLevels: serviceContext?.appropriateIphsLevels,
      iphsEvidenceStatus: serviceContext?.iphsEvidenceStatus,
      knowledge_sources: [
        ...results.map(({ facility }) => ({
          title: facility.name,
          source: 'Structured facility source',
          version: facility.sourceVersion || 'Unknown',
        })),
        ...Array.from(
          new Map(
            matchedDemoCapabilities.map((capability) => [
              `${capability.sourceType}:${capability.source}`,
              {
                title: 'Synthetic facility capability mapping',
                source: capability.source,
                version: capability.sourceType,
                verified: capability.verified,
                demoOnly: capability.demoOnly,
              },
            ]),
          ).values(),
        ),
        ...(serviceContext?.iphsSources || []),
      ],
    };
  }

  /** Keeps facility-level reasoning restricted to governed IPHS 2022 chunks. */
  private iphs2022Evidence(
    result: KnowledgeRetrievalResult,
    evidenceTerms: string[] = [],
  ): KnowledgeRetrievalResult {
    const matchedChunks = result.matchedChunks
      .filter((chunk) => {
        const provenance = [
          chunk.title,
          chunk.source,
          chunk.documentVersion,
          JSON.stringify(chunk.metadata || {}),
        ].join(' ');
        return (
          /IPHS|INDIAN PUBLIC HEALTH STANDARDS/i.test(provenance) &&
          /2022/i.test(provenance)
        );
      })
      .filter(
        (chunk) =>
          evidenceTerms.length === 0 ||
          evidenceTerms.some((term) => {
            const pattern = iphsServiceTermPattern(term);
            return pattern
              ? new RegExp(pattern, 'i').test(chunk.content)
              : false;
          }),
      )
      .slice(0, evidenceTerms.length ? 8 : result.matchedChunks.length);
    return {
      ...result,
      matchedChunks,
      retrievedCount: matchedChunks.length,
      sources: result.sources.filter((source) =>
        matchedChunks.some(
          (chunk) =>
            chunk.title === source.title &&
            chunk.documentVersion === source.version,
        ),
      ),
      formattedKnowledgePrompt: matchedChunks
        .map(
          (chunk) =>
            `[IPHS 2022 SOURCE]\nTitle: ${chunk.title}\nSource: ${chunk.source}\nVersion: ${chunk.documentVersion}\nContent:\n${chunk.content}\n[/IPHS 2022 SOURCE]`,
        )
        .join('\n\n'),
    };
  }

  private async resolveIphsLevelsForService(
    tenantId: string,
    service: string,
    language: string,
    state: string | undefined,
    correlationId: string,
  ): Promise<{
    levels: VerifiedIphsLevel[];
    sources: KnowledgeSourceCitation[];
    evidenceStatus: IphsEvidenceStatus;
  }> {
    if (!this.knowledgeRetrievalService) {
      return { levels: [], sources: [], evidenceStatus: 'UNAVAILABLE' };
    }
    try {
      const serviceSearch = IPHS_SERVICE_SEARCH_TERMS.find(({ service: key }) =>
        key.test(service.trim()),
      );
      const evidenceTerms = (
        serviceSearch?.evidenceTerms || [service.trim()]
      ).filter((term) => Boolean(iphsServiceTermPattern(term)));
      if (!evidenceTerms.length) {
        return { levels: [], sources: [], evidenceStatus: 'NOT_VERIFIED' };
      }
      const semantic = await this.knowledgeRetrievalService.retrieve(
        serviceSearch?.query ||
          `IPHS 2022 diagnostic service ${service} appropriate facility level essential desirable`,
        {
          tenantId,
          intent: 'FACILITY_SERVICE_LEVEL',
          language,
          domain: 'healthcare_facilities',
          category: 'iphs_2022_facility_standards',
          state,
          stateMatchMode: 'INCLUDING_GLOBAL',
          maxResults: 8,
          minRelevanceScore: 0.25,
          maxContextLength: 12000,
        },
      );
      if (semantic.providerType !== 'postgres_pgvector') {
        return { levels: [], sources: [], evidenceStatus: 'UNAVAILABLE' };
      }
      const semanticEvidence = this.iphs2022Evidence(semantic, evidenceTerms);
      const ensureServiceTable = /^(?:X-ray|MRI)$/i.test(service.trim());
      const lexical =
        ensureServiceTable || semanticEvidence.matchedChunks.length < 3
          ? (await this.knowledgeRetrievalService.retrieveIphsServiceChunks?.(
              evidenceTerms,
              tenantId,
              state,
              ensureServiceTable ? 6 : 3,
            )) || []
          : [];
      const seen = new Set<string>();
      const matchedChunks = [
        ...lexical,
        ...semanticEvidence.matchedChunks,
      ].filter(
        (chunk) => !seen.has(chunk.chunkId) && Boolean(seen.add(chunk.chunkId)),
      );
      const retrieved = this.iphs2022Evidence(
        {
          ...semantic,
          matchedChunks,
          sources: [
            ...semantic.sources,
            ...lexical.map((chunk) => ({
              title: chunk.title,
              source: chunk.source,
              version: chunk.documentVersion,
              domain: chunk.domain,
            })),
          ],
        },
        evidenceTerms,
      );
      if (!retrieved.matchedChunks.length) {
        return { levels: [], sources: [], evidenceStatus: 'NOT_VERIFIED' };
      }

      // The CHC IPHS 2022 diagnostic-services table explicitly marks digital
      // X-ray essential. This exact, tenant-scoped source is stronger than
      // incidental X-ray equipment mentions and does not assert availability
      // at any named facility.
      const xrayChcTable = /^X-ray$/i.test(service.trim())
        ? retrieved.matchedChunks.find(
            (chunk) =>
              /IPHS 2022.*CHC/i.test(chunk.title) &&
              /Diagnostic Services[\s\S]{0,800}Digital\s*x[\s-]*ray\s+E\b/i.test(
                chunk.content,
              ),
          )
        : undefined;
      if (xrayChcTable) {
        return {
          levels: ['CHC'],
          sources: retrieved.sources.filter(
            (source) => source.title === xrayChcTable.title,
          ),
          evidenceStatus: 'VERIFIED',
        };
      }

      const generated = await this.aiProvider.generate(
        `${retrieved.formattedKnowledgePrompt}\n\nRequested service: ${JSON.stringify(service)}\nSelect every IPHS facility level where the supplied IPHS 2022 text explicitly lists this service or an unambiguous equivalent. Essential, desirable, and linked services may be selected, but they are not proof that an individual facility provides the service. If the supplied text does not support the service, return NOT_VERIFIED and no levels.`,
        {
          responseFormat: 'json',
          temperature: 0,
          maxTokens: 300,
          thinkingLevel: 'MINIMAL',
          correlationId,
          telemetryLabel: 'FACILITY_IPHS_SERVICE_LEVEL',
          jsonSchema: {
            type: 'OBJECT',
            properties: {
              evidenceStatus: {
                type: 'STRING',
                enum: ['VERIFIED', 'NOT_VERIFIED'],
              },
              levels: {
                type: 'ARRAY',
                items: {
                  type: 'STRING',
                  enum: ['HWC_SHC', 'HWC_PHC', 'CHC', 'SDH', 'DH'],
                },
              },
            },
            required: ['evidenceStatus', 'levels'],
          },
        },
      );
      const json = generated.json || {};
      const allowed = new Set<VerifiedIphsLevel>([
        'HWC_SHC',
        'HWC_PHC',
        'CHC',
        'SDH',
        'DH',
      ]);
      const levels = Array.isArray(json['levels'])
        ? Array.from(
            new Set(
              json['levels'].filter(
                (value): value is VerifiedIphsLevel =>
                  typeof value === 'string' &&
                  allowed.has(value as VerifiedIphsLevel),
              ),
            ),
          )
        : [];
      if (json['evidenceStatus'] === 'NOT_VERIFIED') {
        return { levels: [], sources: [], evidenceStatus: 'NOT_VERIFIED' };
      }
      if (json['evidenceStatus'] !== 'VERIFIED' || !levels.length) {
        return { levels: [], sources: [], evidenceStatus: 'UNAVAILABLE' };
      }
      return {
        levels,
        sources: retrieved.sources,
        evidenceStatus: 'VERIFIED',
      };
    } catch (error: unknown) {
      this.logger.warn(
        `IPHS service-level resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { levels: [], sources: [], evidenceStatus: 'UNAVAILABLE' };
    }
  }

  /**
   * Gives the response generator only the governed structured fields relevant
   * to the semantic subject of a scheme question. Retrieval remains unchanged;
   * this prevents a broad source record from inviting an all-in-one answer.
   */
  private scopedSchemeFacts(
    schemes: Scheme[],
    scope?: SchemeInformationType,
  ): string {
    // Availability is an inventory, so every source-backed matching scheme is
    // supplied. Other subjects remain bounded to keep an individual answer
    // concise without altering the underlying retrieval set.
    const relevantSchemes =
      scope === 'SCHEME_AVAILABILITY' ? schemes : schemes.slice(0, 3);
    return relevantSchemes
      .map((scheme) => {
        const facts = [
          `Scheme: ${scheme.name}`,
          `Scope: ${scheme.geographyScope}${scheme.state ? ` (${scheme.state})` : ''}`,
        ];
        switch (scope) {
          case 'SCHEME_OVERVIEW':
            if (scheme.description)
              facts.push(`Overview: ${scheme.description}`);
            if (scheme.benefitsDescription)
              facts.push(`Benefits: ${scheme.benefitsDescription}`);
            if (scheme.coverageInformation)
              facts.push(`Coverage: ${scheme.coverageInformation}`);
            if (scheme.eligibilityCriteria)
              facts.push(`Eligibility criteria: ${scheme.eligibilityCriteria}`);
            if (scheme.helpline) facts.push(`Helpline: ${scheme.helpline}`);
            break;
          case 'SCHEME_AVAILABILITY':
            break;
          case 'SCHEME_ELIGIBILITY':
            if (scheme.eligibilityCriteria)
              facts.push(`Eligibility criteria: ${scheme.eligibilityCriteria}`);
            facts.push(
              'Personal eligibility status: ELIGIBILITY_CHECK_REQUIRED. Do not say the patient is eligible.',
            );
            break;
          case 'SCHEME_DOCUMENTS':
            facts.push(
              scheme.requiredDocuments?.length
                ? `Required documents: ${scheme.requiredDocuments.join(', ')}`
                : 'Required documents: not confirmed by this structured source',
            );
            break;
          case 'SCHEME_APPLICATION':
            if (scheme.applicationProcess)
              facts.push(`Application process: ${scheme.applicationProcess}`);
            if (scheme.officialUrl)
              facts.push(`Official route: ${scheme.officialUrl}`);
            if (scheme.helpline) facts.push(`Helpline: ${scheme.helpline}`);
            break;
          case 'SCHEME_BENEFITS':
            if (scheme.benefitsDescription)
              facts.push(`Benefits: ${scheme.benefitsDescription}`);
            if (scheme.coverageInformation)
              facts.push(`Coverage: ${scheme.coverageInformation}`);
            break;
          case 'SCHEME_COMPARISON':
            if (scheme.description)
              facts.push(`Overview: ${scheme.description}`);
            break;
          // SCHEME_FACILITY and SCHEME_UNKNOWN deliberately add no unrelated
          // scheme facts. Facility facts are owned by FacilityAgent, and an
          // unknown scheme must not be silently substituted with a known one.
          default:
            break;
        }
        return facts.join(' | ');
      })
      .join('\n');
  }

  private async resolveAuthorizedPatient(
    sessionId: string,
    identity: HostIdentity,
  ): Promise<{
    patient: PatientDataRecord | null;
    patientRef: string;
    session: Session | null;
  }> {
    let session: Session | null = null;
    let patientRef = identity.externalId;

    if (this.sessions) {
      try {
        session = await this.sessions.findOne({
          where: { id: sessionId },
        });
        if (session?.subjectAbhaRef) {
          patientRef = session.subjectAbhaRef;
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to find session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!this.patientData) {
      return { patient: null, patientRef, session };
    }

    try {
      let patient = await this.patientData.getPatientByReference(
        identity.tenantId,
        patientRef,
      );
      if (!patient) {
        patient = await this.patientData.getPatient(
          identity.tenantId,
          patientRef,
        );
      }
      return { patient, patientRef, session };
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to resolve authorized patient for session ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { patient: null, patientRef, session };
    }
  }

  private detectIdentityMismatch(
    inputText: string,
    authorizedName?: string,
  ): { isMismatch: boolean; claimedName?: string; authorizedName?: string } {
    if (!authorizedName) {
      return { isMismatch: false };
    }

    const trimmedInput = inputText
      .normalize('NFKC')
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!trimmedInput) {
      return { isMismatch: false };
    }

    // Common non-name words that follow self-declarations (e.g. "I am sick", "Main theek hoon")
    const nonNameWords = new Set([
      'sick',
      'ill',
      'fine',
      'okay',
      'ok',
      'good',
      'well',
      'better',
      'worse',
      'diabetic',
      'pregnant',
      'having',
      'feeling',
      'suffering',
      'experiencing',
      'taking',
      'asking',
      'here',
      'back',
      'new',
      'not',
      'tired',
      'dizzy',
      'worried',
      'in',
      'at',
      'with',
      'a',
      'an',
      'the',
      'patient',
      'user',
      'theek',
      'thik',
      'bimar',
      'beemar',
      'pareshan',
      'dard',
      'khush',
      'accha',
      'achha',
      'sahi',
      'ready',
      'calling',
      'writing',
      'typing',
      'speaking',
      'looking',
      'searching',
      'wondering',
      'confused',
      'doctor',
      'dr',
      'madad',
      'help',
      'koshish',
      'aaya',
      'aayi',
      'bataiye',
      'bol',
      'boliye',
    ]);

    const selfPatterns: RegExp[] = [
      // Hindi / Hinglish: "Main Sunita hoon", "Mai Sunita hu", "Hum Sunita hain".
      // Not "mein ... hai": in Hinglish that is "in ... is" ("hospital mein ilaaj hota hai").
      /\b(?:main|mein|mai)\s+([a-zA-Zऀ-ॿ]+(?:\s+[a-zA-Zऀ-ॿ]+)?)\s+(?:hoon|hu|hun)\b/i,
      /\bhum\s+([a-zA-Zऀ-ॿ]+(?:\s+[a-zA-Zऀ-ॿ]+)?)\s+hain\b/i,
      // Hindi: "Mera naam Sunita hai", "Hamara naam Sunita hai"
      /\b(?:mera|hamara)\s+naam\s+(?:bhi\s+)?([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?)\s+hai\b/i,
      // English: "I am Sunita", "I'm Sunita", "Im Sunita"
      /\b(?:i\s*am|i'm|im)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)(?:\s+and|\s*,|\s*\.|\s*$|\s+here|\s+speaking|\s+from)/i,
      // English: "My name is Sunita", "Call me Sunita"
      /\b(?:my\s+name\s+is|call\s+me)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
      // Persona switch request: "Switch to Sunita", "Acting as Sunita", "Speaking as Sunita"
      /\b(?:switch\s+to|acting\s+as|speaking\s+as)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
    ];

    // A correction names the person after "but" or "नहीं". The earlier
    // name is the one being denied, often the authenticated profile name.
    const correctionPatterns = [
      // "ak" is a common STT substitution for "am"; accept it only in this
      // explicit "I ... not [name] but [name]" identity correction.
      /\b(?:i\s*(?:am|ak)|i'm|im)\s+not\s+[a-z]+(?:\s+[a-z]+)?\s+(?:but|rather)\s+([a-z]+(?:\s+[a-z]+)?)(?:\b|$)/i,
      /\b(?:main|mein|mai|hum)\s+[a-z]+(?:\s+[a-z]+)?\s+(?:nahi|nahin|nhi|nai)\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:hoon|hu|hun|hain)\b/i,
      /मैं\s+[\u0900-\u097F]+(?:\s+[\u0900-\u097F]+)?\s+नहीं\s+([\u0900-\u097F]+(?:\s+[\u0900-\u097F]+)?)\s+हूँ/u,
    ];
    let extractedClaim: string | null =
      correctionPatterns
        .map((pattern) => trimmedInput.match(pattern)?.[1]?.trim())
        .find(
          (claim) =>
            claim && !nonNameWords.has(claim.split(/\s+/)[0].toLowerCase()),
        ) || null;
    for (const pattern of selfPatterns) {
      if (extractedClaim) break;
      const match = trimmedInput.match(pattern);
      if (match && match[1]) {
        const candidate = match[1].trim();
        const firstWord = candidate.split(/\s+/)[0].toLowerCase();
        if (!nonNameWords.has(firstWord)) {
          extractedClaim = candidate;
          break;
        }
      }
    }

    if (!extractedClaim) {
      return { isMismatch: false };
    }

    // Normalize authorized name tokens (e.g. "Vijay Chauhan" -> ["vijay", "chauhan"])
    const cleanAuth = authorizedName
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097F\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1);

    // Normalize claimed name tokens
    const cleanClaim = extractedClaim
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097F\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1);

    if (cleanClaim.length === 0) {
      return { isMismatch: false };
    }

    // Check if any token of the claimed name matches any token of the authorized name
    const matchesAuthorized = cleanClaim.some((token) =>
      cleanAuth.includes(token),
    );
    if (matchesAuthorized) {
      return { isMismatch: false };
    }

    // Also handle honorifics / suffixes like "Sunita ji" -> "Sunita"
    const honorifics = new Set(['ji', 'shri', 'smt', 'mr', 'mrs', 'ms', 'dr']);
    const nonHonorificClaim = cleanClaim.filter((t) => !honorifics.has(t));
    if (
      nonHonorificClaim.length > 0 &&
      nonHonorificClaim.some((token) => cleanAuth.includes(token))
    ) {
      return { isMismatch: false };
    }

    return {
      isMismatch: true,
      claimedName: extractedClaim,
      authorizedName,
    };
  }

  async orchestrateTurn(
    request: AiOrchestratorRequest,
  ): Promise<AiOrchestratorResult> {
    const startTime = Date.now();
    const {
      sessionId,
      inputText,
      correlationId,
      identity,
      vdaConsentArtifactId,
      language,
      prescriptionId,
      prescriptionContextRequired,
    } = request;

    this.logger.log(
      `[AiOrchestrator] Turn execution started sessionId=${sessionId} correlationId=${correlationId}`,
    );

    // Resolve authorized patient and active session for RBAC
    const { patient: authorizedPatient, patientRef: authorizedPatientRef } =
      await this.resolveAuthorizedPatient(sessionId, identity);
    const authorizedPatientName = authorizedPatient?.name;

    // Prescription context is stored server-side and contains only the active
    // confirmed prescription's safe fields plus local reminder times. Raw input
    // resolves a minimal subset locally; it is never forwarded to Gemini.
    let prescriptionContext =
      await this.prescriptionSessionContext.get(sessionId);
    if (
      !prescriptionContext &&
      /\b(?:medicine|medicines|medication|dawa|dawai|prescription)\b|दवा|दवाई|दवाइ|पर्ची/i.test(
        inputText,
      )
    ) {
      prescriptionContext =
        await this.prescriptionSessionContext.currentVerifiedForPatient(
          sessionId,
          identity,
        );
    }
    const prescriptionResponseLanguage =
      prescriptionContext?.pendingMedicationSafetyLanguage ||
      language ||
      (prescriptionContextRequired
        ? await this.languageProvider.detectLanguage(inputText)
        : undefined) ||
      identity.preferredLanguage ||
      'en';
    // A missed-dose selection is valid for the immediately following turn only.
    // The loaded value remains available to this turn's resolver, then is cleared.
    if (prescriptionContext?.pendingMedicationSafety) {
      await this.prescriptionSessionContext.clearPendingMedicationSafety(
        sessionId,
      );
    }
    const prescriptionContextResolution =
      this.resolvePrescriptionContextQuestion(
        prescriptionContext,
        inputText,
        prescriptionResponseLanguage,
      );
    const labReportQuestion =
      /(?:\b(?:sugar|glucose|hba1c)\b|शुगर|ग्लूकोज|एच\s*बी\s*ए\s*वन\s*सी)/i.test(
        inputText,
      ) &&
      /(?:\b(?:report|result|value|reading|explain|understand|mean)\b|रिपोर्ट|जांच|जाँच|समझ|नतीजा|परिणाम|मान)/i.test(
        inputText,
      ) &&
      prescriptionContextResolution?.kind !== 'CLINICAL_MEDICATION_DECISION';
    const isPrescriptionContextTurn = Boolean(prescriptionContextResolution);
    const isPrescriptionContextGenerationTurn =
      prescriptionContextResolution?.kind === 'MEDICINE_EDUCATION' ||
      prescriptionContextResolution?.kind === 'INVESTIGATION_EDUCATION' ||
      prescriptionContextResolution?.kind === 'MEDICINE_FOR_BP';
    const isPrescriptionGuidelineTurn = false;
    const outboundQuestion = isPrescriptionContextGenerationTurn
      ? prescriptionContextResolution.question
      : null;
    let resolvedInputText = outboundQuestion || inputText;
    let latestPrescription = null;
    const isPrescriptionExplanationTurn = Boolean(prescriptionId);

    if (this.prescriptions) {
      try {
        latestPrescription = await this.prescriptions.findOne({
          where: {
            ...(prescriptionId ? { id: prescriptionId } : {}),
            tenantId: identity.tenantId,
            patientRef: authorizedPatientRef,
            sessionId,
          },
          order: { createdAt: 'DESC' },
        });
      } catch (dbErr) {
        this.logger.error(
          `Failed to lookup latest prescription: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
    }

    // Audit AI Request Started
    await this.auditService.logEvent({
      tenantId: identity.tenantId,
      subjectAbhaRef: identity.externalId,
      actingPrincipal: identity.externalId,
      correlationId,
      action: 'ai_request_started',
      entityName: 'turn',
      entityId: sessionId,
      details: {
        sessionId,
        inputLength: resolvedInputText.length,
      },
    });

    // ─── LangSmith Turn Tracing Context ─────────────────────────────────────
    // Prescription-context turns do not create external traces: the session
    // context and original patient input must remain inside the VDA boundary.
    const traceContext: TurnTraceContext | null =
      this.tracer && !isPrescriptionContextTurn && !prescriptionContextRequired
        ? await this.tracer.startTurn({
            sessionId,
            correlationId,
            inputText: resolvedInputText,
            language,
            tenantId: identity.tenantId,
            externalId: identity.externalId,
          })
        : null;

    // ─── Step 1: Deterministic pre-generation safety gate ───────────────────
    // Safety is intentionally evaluated before normal Gemini classification,
    // retrieval, or agent routing.
    let requestLanguage = isPrescriptionContextTurn
      ? prescriptionResponseLanguage
      : language;
    if (!requestLanguage) {
      if (traceContext && this.tracer) {
        requestLanguage = await this.tracer.traceStep(
          traceContext,
          {
            name: 'language_detection',
            runType: 'tool',
            provider: 'sarvam',
            necessity: 'NECESSARY',
            necessityReason:
              'Language was not provided by client; required external Sarvam language detection.',
          },
          () => this.languageProvider.detectLanguage(resolvedInputText),
        );
      } else {
        requestLanguage =
          await this.languageProvider.detectLanguage(resolvedInputText);
      }
    } else if (traceContext && this.tracer) {
      this.tracer.recordStepDirectly(
        traceContext,
        {
          name: 'language_detection',
          runType: 'tool',
          provider: 'rule-engine',
          model: 'client-language',
          necessity: 'BYPASSED_SAFE',
          necessityReason: `Client explicitly specified language "${language}"; avoided redundant Sarvam language detection.`,
        },
        { latencyMs: 0, executed: false },
      );
    }

    // Clinical review: answer in a language the patient explicitly asks for.
    const askedLanguage = explicitlyRequestedLanguage(inputText);
    if (askedLanguage && !requestLanguage?.startsWith(askedLanguage)) {
      requestLanguage = askedLanguage;
    }

    // Safety always sees the original input locally, before any sanitized
    // prompt construction. It never egresses raw patient text.
    const safetyInputText = inputText;
    const preSafetyResult =
      traceContext && this.tracer
        ? await this.tracer.traceStep(
            traceContext,
            {
              name: 'safety_gate_pre_evaluation',
              runType: 'tool',
              provider: 'safety-gate',
              necessity: 'NECESSARY',
              necessityReason:
                'Mandatory clinical safety gate evaluating cardiac, suicide, and clinical red flags.',
            },
            () =>
              this.safetyGate.evaluateSafety(
                safetyInputText,
                correlationId,
                requestLanguage,
              ),
          )
        : await this.safetyGate.evaluateSafety(
            safetyInputText,
            correlationId,
            requestLanguage,
          );

    if (preSafetyResult.status !== 'SAFE') {
      const safetyStatus =
        preSafetyResult.status === 'ESCALATION_REQUIRED'
          ? 'ESCALATED_BY_RULE'
          : 'WITHHELD_BY_RULE';
      const responseType =
        preSafetyResult.status === 'ESCALATION_REQUIRED'
          ? 'escalation'
          : 'text';
      const safeMessage =
        preSafetyResult.patientSafeMessage ||
        (requestLanguage.startsWith('hi')
          ? 'सुरक्षा कारणों से इस अनुरोध पर सामान्य उत्तर उपलब्ध नहीं है।'
          : 'A normal response is not available for this request because of safety policy.');
      let emergencyFacilities: Array<Record<string, unknown>> = [];
      let emergencyCards: Array<Record<string, unknown>> = [];
      // Emergency classification is wholly owned by SafetyGate. A facility
      // lookup is supplementary and occurs only for an explicit known scope;
      // PM-JAY listing never implies emergency capability.
      if (
        preSafetyResult.status === 'ESCALATION_REQUIRED' &&
        this.facilitySearch &&
        this.knowledgeQueryNormalizer
      ) {
        const location = await this.facilityLocation(
          sessionId,
          resolvedInputText,
          requestLanguage,
        );
        if (location.state || location.district) {
          const facilities = await this.facilitySearch.searchWithSchemes(
            identity.tenantId,
            {
              state: location.state,
              district: location.district,
              city: location.city,
              locality: location.locality,
              emergency: true,
              limit: 5,
            },
          );
          const content = this.facilityContent(
            facilities,
            location,
            requestLanguage,
            undefined,
            true,
          );
          emergencyFacilities = content.facility_results;
          emergencyCards = content.cards;
        }
      }

      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: identity.externalId,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'ai_pre_generation_safety_blocked',
        entityName: 'turn',
        entityId: sessionId,
        details: {
          intent: 'SAFETY_PRECEDENCE',
          ruleId: preSafetyResult.ruleId,
        },
      });

      const earlySafeContent =
        responseType === 'escalation'
          ? {
              escalation_id: preSafetyResult.ruleId || 'SAFETY_ESCALATION',
              reason: safeMessage,
              summary: safeMessage,
              assigned_role: 'CLINICIAN',
              ...(emergencyFacilities.length
                ? { facility_results: emergencyFacilities }
                : {}),
              ...(emergencyCards.length ? { cards: emergencyCards } : {}),
              ...(emergencyFacilities.length
                ? {
                    emergency_capability_note: requestLanguage.startsWith('hi')
                      ? 'उपलब्ध रिकॉर्ड में emergency सुविधा की पुष्टि नहीं है।'
                      : 'Available records do not confirm emergency capability.',
                  }
                : {}),
            }
          : { summary: safeMessage, [requestLanguage]: safeMessage };

      if (traceContext && this.tracer) {
        await this.tracer.endTurn(traceContext, {
          responseType,
          content: earlySafeContent,
          intent: IntentType.UNKNOWN,
          selectedAgent: 'safety-gate',
          safetyStatus,
        });
      }

      return {
        responseType,
        content: earlySafeContent,
        intent: IntentType.UNKNOWN,
        selectedAgent: 'safety-gate',
        safetyStatus,
        latencyMs: Date.now() - startTime,
      };
    }

    // Identity claims are checked after clinical safety, before any patient
    // prescription facts or lab records can be returned.
    const identityCheck = this.detectIdentityMismatch(
      inputText,
      authorizedPatientName,
    );
    if (identityCheck.isMismatch) {
      this.logger.warn(
        `[AiOrchestrator] Identity mismatch blocked: session=${sessionId}`,
      );
      const identityResponseHindi = requestLanguage.startsWith('hi');
      const message = identityResponseHindi
        ? `अभी ${identityCheck.authorizedName} की प्रोफ़ाइल खुली है। ${identityCheck.claimedName} की जानकारी देखने के लिए ऐप में उनकी प्रोफ़ाइल चुनें।`
        : `You're currently using ${identityCheck.authorizedName}'s profile. To access ${identityCheck.claimedName}'s health information, please switch to ${identityCheck.claimedName}'s profile in the app.`;
      const content = {
        summary: message,
        [requestLanguage]: message,
        actions: [
          {
            label: identityResponseHindi ? 'प्रोफ़ाइल बदलें' : 'Switch Profile',
            action: 'SWITCH_PROFILE',
          },
        ],
      };
      if (traceContext && this.tracer) {
        await this.tracer.endTurn(traceContext, {
          responseType: 'text',
          content,
          intent: IntentType.UNKNOWN,
          selectedAgent: 'rbac-identity-guard',
          safetyStatus: 'IDENTITY_ACCESS_RESTRICTED',
        });
      }
      return {
        responseType: 'text',
        content,
        intent: IntentType.UNKNOWN,
        selectedAgent: 'rbac-identity-guard',
        safetyStatus: 'IDENTITY_ACCESS_RESTRICTED',
        latencyMs: Date.now() - startTime,
      };
    }

    // Narrow, non-prescriptive education for topics absent from the published
    // ASHA NCD module. Sources: NHS fever in adults and CDC A1C testing.
    // This runs only after the safety and identity gates; report values and
    // prescription questions keep their existing authorized routes.
    const educationTopic =
      !prescriptionId && !prescriptionContextResolution
        ? basicEducationTopic(inputText, authorizedPatient?.age)
        : null;
    const hindiEducation = requestLanguage.startsWith('hi');
    const feverEducation = educationTopic === 'FEVER';
    const hba1cEducation = educationTopic === 'HBA1C';
    if (feverEducation || hba1cEducation) {
      const summary = feverEducation
        ? hindiEducation
          ? 'बुखार में आराम करें, पानी या दूसरे तरल लेते रहें और तापमान जाँचें।'
          : 'If you have a fever, rest, drink fluids, and check your temperature.'
        : hindiEducation
          ? 'HbA1c खून की जाँच है। यह पिछले लगभग 2–3 महीनों की औसत शुगर दिखाती है, आज की शुगर नहीं।'
          : 'HbA1c is a blood test showing average blood sugar over roughly the past 2–3 months, not today’s reading.';
      const details = feverEducation
        ? hindiEducation
          ? [
              'बुखार घर की देखभाल के बाद भी ठीक न हो या बढ़े, तो डॉक्टर से बात करें।',
              'बुखार कब से है और तापमान कितना है?',
            ]
          : [
              'If the fever is getting worse or not improving with home care, speak to a clinician.',
              'How long have you had a fever, and what is your temperature?',
            ]
        : hindiEducation
          ? [
              'आपकी रिपोर्ट देखे बिना मैं आपका नतीजा नहीं बता सकती।',
              'रिपोर्ट में HbA1c का मान है तो उसे साझा करें; उसके आधार पर डॉक्टर से अर्थ समझें।',
            ]
          : [
              'I cannot describe your personal result without seeing its verified value.',
              'If you have an HbA1c report, share its value and discuss what it means for you with a clinician.',
            ];
      return {
        responseType: 'text',
        content: {
          summary,
          [requestLanguage]: summary,
          sections: [{ bullets: details }],
        },
        intent: feverEducation
          ? IntentType.GENERAL_HEALTH_QUERY
          : IntentType.LAB_RESULT_QUERY,
        selectedAgent: 'general-health-education',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // Clinically approved fixed answers (see approved-answers.ts), after the
    // safety and identity gates; prescription questions keep their routes.
    const approvedTopic =
      !prescriptionId && !prescriptionContextResolution
        ? approvedAnswerTopic(inputText)
        : null;
    const bmi =
      !prescriptionId && !prescriptionContextResolution
        ? bmiAnswer(inputText)
        : null;
    if (approvedTopic || bmi) {
      const lang = hindiEducation ? 'hi' : 'en';
      const answer = {
        ...(bmi ? bmi[lang] : APPROVED_ANSWERS[approvedTopic!][lang]),
      };
      // Round 3: free dialysis in Faridabad is at B K Civil Hospital.
      if (
        approvedTopic === 'FREE_TESTS' &&
        /faridabad|फरीदाबाद|फ़रीदाबाद/iu.test(
          [
            inputText,
            (await this.facilityLocation(sessionId, inputText, requestLanguage))
              .district ?? '',
          ].join(' '),
        )
      )
        answer.bullets = [...answer.bullets, FARIDABAD_DIALYSIS[lang]];
      return {
        responseType: 'text',
        content: {
          summary: answer.summary,
          [requestLanguage]: answer.summary,
          sections: [
            { bullets: answer.bullets },
            ...(answer.link
              ? [{ body: `${answer.link.text}\n${answer.link.url}` }]
              : []),
          ],
        },
        intent:
          approvedTopic === 'FREE_MEDICINES' || approvedTopic === 'FREE_TESTS'
            ? IntentType.GOVERNMENT_SCHEME_QUERY
            : IntentType.GENERAL_HEALTH_QUERY,
        selectedAgent: 'approved-answer',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // Prescription-scoped treatment decisions are resolved locally and
    // deflected before intent classification, RAG, ClinicalContext, or answer
    // generation. Raw prescription questions therefore retain the existing
    // privacy boundary while no longer receiving missed-dose advice.
    if (
      prescriptionContextResolution?.kind === 'CLINICAL_MEDICATION_DECISION'
    ) {
      const content = this.clinicalDeflectionContent(
        requestLanguage,
        false,
        prescriptionContextResolution.decision,
        inputText,
      );
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: identity.externalId,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'clinical_question_deflected',
        entityName: 'turn',
        entityId: sessionId,
        details: { authorityCategory: AuthorityCategory.CLINICAL_QUESTION },
      });
      return {
        responseType: 'text',
        content,
        intent: IntentType.ADHERENCE_QUERY,
        selectedAgent: 'authority-boundary',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    if (
      prescriptionContextResolution?.kind === 'ADHERENCE_STATUS' ||
      prescriptionContextResolution?.kind === 'REFILL_SUPPORT'
    ) {
      const hindi = requestLanguage.startsWith('hi');
      const message =
        prescriptionContextResolution.kind === 'REFILL_SUPPORT'
          ? hindi
            ? 'दवा खत्म हो रही है तो अपनी पर्ची लेकर डॉक्टर या कम्युनिटी हेल्थ ऑफिसर (CHO) से दवा लें। अपने मन से दवा न बंद करें और न ही बदलें।'
            : 'If your medicine is running out, take your prescription to your doctor or Community Health Officer (CHO) to get more. Do not stop or change your medicine on your own.'
          : prescriptionContextResolution.question === 'CORRECTION'
            ? /\b(?:yesterday|kal)\b|कल/i.test(inputText)
              ? hindi
                ? 'कल का रिकॉर्ड अभी बदला नहीं जा सकता। मैंने कुछ नहीं बदला है।'
                : 'Yesterday’s record cannot be changed yet. I have not changed anything.'
              : hindi
                ? 'आज की दवा के लिए “दवाइयाँ” में उसी दवा और समय पर “नहीं ली” चुनें। मैंने अभी कुछ नहीं बदला है।'
                : 'For today’s dose, open Medicines and choose “Not taken” for that medicine and time. I have not changed anything.'
            : hindi
              ? 'दवा लेने या छूटने की जानकारी आपके फ़ोन में “दवाइयाँ” वाले हिस्से में है। कृपया वहाँ देखें।'
              : 'Your taken and missed doses are saved in Medicines on this phone. Please check there.';
      return {
        responseType: 'text',
        content: { summary: message, [requestLanguage]: message },
        intent: IntentType.ADHERENCE_QUERY,
        selectedAgent: 'medication-adherence',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // Multi-prescription verification and update pipeline
    let allPatientPrescriptions: Prescription[] = [];
    if (this.prescriptions && authorizedPatientRef) {
      try {
        allPatientPrescriptions = await this.prescriptions.find({
          where: {
            tenantId: identity.tenantId,
            patientRef: authorizedPatientRef,
          },
          order: { createdAt: 'DESC' },
        });
      } catch (err) {
        this.logger.warn(`Failed to query patient prescriptions: ${err}`);
      }
    }
    const latestPrescriptionRecord = allPatientPrescriptions[0];
    const previousVerifiedPrescription = allPatientPrescriptions.find(
      (p, index) => index > 0 && p.verificationStatus === 'VERIFIED',
    );
    const hasMultipleWithNewPending =
      Boolean(previousVerifiedPrescription) &&
      Boolean(latestPrescriptionRecord) &&
      (latestPrescriptionRecord.verificationStatus === 'PENDING_VERIFICATION' ||
        latestPrescriptionRecord.verificationStatus === 'UNVERIFIED');
    const isFirstTimePending =
      !previousVerifiedPrescription &&
      Boolean(latestPrescriptionRecord) &&
      (latestPrescriptionRecord.verificationStatus === 'PENDING_VERIFICATION' ||
        latestPrescriptionRecord.verificationStatus === 'UNVERIFIED');

    // Replies follow the profile language; Hinglish questions get Hindi.
    const isHindiPrescription = requestLanguage.startsWith('hi');
    const firstPendingMessage = isHindiPrescription
      ? 'आपकी पर्ची की जाँच कम्युनिटी हेल्थ ऑफिसर (CHO) कर रहे हैं। जाँच पूरी होने के बाद आपकी दवाइयाँ यहाँ दिखेंगी।'
      : 'The Community Health Officer (CHO) is checking your prescription. Your medicines will show here once it is approved.';
    // Clinical review: never tell the patient to keep taking the old medicines;
    // they may already have a new plan from another doctor.
    const newPendingMessage = isHindiPrescription
      ? 'आपकी नई पर्ची पहले वाली से अलग है। इसे यहाँ केवल कम्युनिटी हेल्थ ऑफिसर (CHO) की मंज़ूरी के बाद ही अपडेट किया जा सकता है। कम्युनिटी हेल्थ ऑफिसर (CHO) अभी पर्ची की जाँच कर रहे हैं। कृपया कुछ समय बाद दोबारा कोशिश करें। तब तक दवा के बारे में अपने नजदीकी डॉक्टर या CHO से पूछें।'
      : 'Your new prescription is different from the old one. It can be updated here only after the Community Health Officer (CHO) approves it. The CHO is checking it now. Please try again after some time. Until then, ask your nearest doctor or CHO about your medicines.';

    if (prescriptionContextResolution?.kind === 'PRESCRIPTION_STATUS') {
      const status = latestPrescriptionRecord?.verificationStatus;
      const message = !latestPrescriptionRecord
        ? isHindiPrescription
          ? 'अभी आपकी कोई पर्ची अपलोड नहीं हुई है।'
          : 'You have not uploaded a prescription yet.'
        : hasMultipleWithNewPending
          ? newPendingMessage
          : isFirstTimePending
            ? firstPendingMessage
            : status === 'VERIFIED'
              ? isHindiPrescription
                ? 'आपकी पर्ची की जाँच पूरी हो गई है। आपकी दवाइयाँ तैयार हैं।'
                : 'Your prescription has been checked and your medicines are ready.'
              : status === 'REJECTED'
                ? isHindiPrescription
                  ? 'आपकी पर्ची मंज़ूर नहीं हुई। कृपया डॉक्टर की पर्ची दोबारा अपलोड करें, या स्वास्थ्य केंद्र पर बात करें।'
                  : 'Your prescription was not approved. Please upload your doctor’s prescription again, or talk to your health centre.'
                : status === 'NEEDS_RESUBMISSION'
                  ? isHindiPrescription
                    ? 'पर्ची की फ़ोटो साफ़ नहीं आई। कृपया पर्ची की साफ़ फ़ोटो दोबारा भेजें।'
                    : 'The prescription photo was not clear. Please send a clear photo again.'
                  : isHindiPrescription
                    ? 'आपकी पर्ची की जाँच अभी बाकी है।'
                    : 'Your prescription is still waiting to be checked.';
      return {
        responseType: 'text',
        content: {
          summary: message,
          [requestLanguage]: message,
        },
        intent: IntentType.PRESCRIPTION_QUERY,
        selectedAgent: 'prescription-status',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    if (prescriptionContextResolution?.kind === 'MEDICINE_LIST') {
      // The old list is not shown as an instruction to keep taking it.
      if (hasMultipleWithNewPending) {
        return {
          responseType: 'text',
          content: {
            summary: newPendingMessage,
            [requestLanguage]: newPendingMessage,
          },
          intent: IntentType.MEDICATION_QUERY,
          selectedAgent: 'medication-agent',
          safetyStatus: 'SAFE',
          latencyMs: Date.now() - startTime,
        };
      }

      if (!prescriptionContext?.medicines.length) {
        const message = isFirstTimePending
          ? firstPendingMessage
          : isHindiPrescription
            ? 'अभी आपकी कोई मंज़ूर दवा नहीं है।'
            : 'You have no approved medicines yet.';
        return {
          responseType: 'text',
          content: {
            summary: message,
            [requestLanguage]: message,
          },
          intent: IntentType.MEDICATION_QUERY,
          selectedAgent: 'medication-agent',
          safetyStatus: 'SAFE',
          latencyMs: Date.now() - startTime,
        };
      }
    }

    if (
      prescriptionContextResolution?.kind === 'REMINDER_FACT' &&
      !prescriptionContext?.medicines.length
    ) {
      const message = isFirstTimePending
        ? isHindiPrescription
          ? 'आपकी पर्ची की जाँच कम्युनिटी हेल्थ ऑफिसर (CHO) कर रहे हैं। जाँच पूरी होने के बाद रिमाइंडर लगाए जा सकेंगे।'
          : 'The Community Health Officer (CHO) is checking your prescription. Reminders can be set once it is approved.'
        : isHindiPrescription
          ? 'अभी कोई मंज़ूर दवा या रिमाइंडर का समय नहीं है।'
          : 'There is no approved medicine or reminder time yet.';
      return {
        responseType: 'text',
        content: {
          summary: message,
          [requestLanguage]: message,
        },
        intent: IntentType.MEDICATION_QUERY,
        selectedAgent: 'medication-reminder-service',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // Prescription facts and missed-dose clarification are deterministic facts
    // from the server-held sanitized session context.
    if (
      prescriptionContext &&
      prescriptionContextResolution &&
      (prescriptionContextResolution.kind === 'MEDICINE_LIST' ||
        prescriptionContextResolution.kind === 'MEDICINE_FACT' ||
        prescriptionContextResolution.kind === 'REMINDER_FACT' ||
        prescriptionContextResolution.kind === 'INVESTIGATION_LIST')
    ) {
      const effectiveRxLang = requestLanguage.startsWith('hi')
        ? 'hi'
        : requestLanguage;
      const content = this.prescriptionContextDirectContent(
        prescriptionContext,
        prescriptionContextResolution,
        effectiveRxLang,
      );
      if (
        authorizedPatientName &&
        /\b(?:what is my name|what's my name|who am i)\b|मेरा नाम क्या है|मेरी पहचान क्या है/i.test(
          inputText,
        )
      ) {
        const namePrefix = requestLanguage.startsWith('hi')
          ? `अभी ${authorizedPatientName} की प्रोफ़ाइल खुली है। `
          : `You are using ${authorizedPatientName}'s profile. `;
        content['summary'] = `${namePrefix}${content['summary']}`;
        content[requestLanguage] = content['summary'];
      }
      content['provenance'] =
        prescriptionContextResolution.kind === 'REMINDER_FACT'
          ? 'REMINDER'
          : 'PRESCRIPTION';
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: identity.externalId,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'prescription_session_context_used',
        entityName: 'turn',
        entityId: sessionId,
        details: {
          contextType: prescriptionContextResolution.kind,
          contextFieldCount:
            prescriptionContextResolution.kind === 'REMINDER_FACT'
              ? prescriptionContext.reminders.length
              : prescriptionContextResolution.kind === 'MEDICINE_LIST'
                ? prescriptionContext.medicines.length
                : prescriptionContextResolution.kind === 'MEDICINE_FACT'
                  ? 1
                  : prescriptionContext.investigations.length,
          piiRedacted: true,
        },
      });
      return {
        responseType: 'text',
        content,
        intent:
          prescriptionContextResolution.kind === 'INVESTIGATION_LIST'
            ? IntentType.PRESCRIPTION_QUERY
            : IntentType.MEDICATION_QUERY,
        selectedAgent:
          prescriptionContextResolution.kind === 'REMINDER_FACT'
            ? 'medication-reminder-service'
            : 'medication-agent',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // The app marks medicine/test questions as prescription-scoped. If the
    // server context is missing or cannot resolve the reference, fail closed
    // rather than falling through to ClinicalContext or FHIR medications.
    if (
      prescriptionContextRequired &&
      !prescriptionContextResolution &&
      !labReportQuestion
    ) {
      return {
        responseType: 'text',
        content: this.unmatchedPrescriptionContent(
          prescriptionContext,
          requestLanguage,
        ),
        intent: IntentType.PRESCRIPTION_QUERY,
        selectedAgent: 'medication-agent',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // A new upload with no trustworthy extracted medicine facts must never fall
    // through to ClinicalContext, conversation history, or an LLM explanation.
    // This is deliberately before classification, retrieval, and generation.
    if (
      isPrescriptionExplanationTurn &&
      (!latestPrescription ||
        !['EXTRACTED', 'APPROVED'].includes(
          latestPrescription.extractionStatus,
        ) ||
        !Array.isArray(latestPrescription.medications) ||
        latestPrescription.medications.length === 0)
    ) {
      const noMedicineMessage = requestLanguage.startsWith('hi')
        ? 'इस फाइल में मुझे दवाइयों की जानकारी नहीं मिली। कृपया पर्ची की साफ फोटो या PDF दोबारा अपलोड करें।'
        : 'I could not find medicine information in this file. Please upload a clear prescription photo or PDF again.';
      const prescriptionContent = {
        summary: noMedicineMessage,
        [requestLanguage]: noMedicineMessage,
      };

      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: identity.externalId,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'prescription_explanation_blocked_untrusted_extraction',
        entityName: 'prescription',
        entityId: latestPrescription?.id || prescriptionId || sessionId,
        details: {
          extractionStatus: latestPrescription?.extractionStatus || 'NOT_FOUND',
          medicinesCount: latestPrescription?.medications?.length || 0,
        },
      });

      if (traceContext && this.tracer) {
        this.tracer.recordStepDirectly(
          traceContext,
          {
            name: 'prescription_source_isolation_guard',
            runType: 'tool',
            provider: 'rule-engine',
            necessity: 'NECESSARY',
            necessityReason:
              'Blocks untrusted or empty prescription extraction before medication explanation generation.',
          },
          { latencyMs: 0 },
        );
        await this.tracer.endTurn(traceContext, {
          responseType: 'text',
          content: prescriptionContent,
          intent: 'PRESCRIPTION_QUERY',
          selectedAgent: 'prescription-source-isolation-guard',
          safetyStatus: 'SAFE',
        });
      }

      return {
        responseType: 'text',
        content: prescriptionContent,
        intent: 'PRESCRIPTION_QUERY',
        selectedAgent: 'prescription-source-isolation-guard',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    if (labReportQuestion) {
      let report: ClinicalContext | null = null;
      if (vdaConsentArtifactId) {
        try {
          report = await this.clinicalContextService.buildContext({
            sessionId,
            tenantId: identity.tenantId,
            subjectAbhaRef: identity.externalId,
            vdaConsentArtifactId,
            intent: IntentType.LAB_RESULT_QUERY,
            requiredRecordCategories: [
              HealthRecordCategory.LAB_REPORT,
              HealthRecordCategory.INVESTIGATION,
            ],
            correlationId,
          });
        } catch {
          // Missing consent or unavailable records are not evidence of a result.
        }
      }
      const requestedTest = /hba1c|एच\s*बी\s*ए\s*वन\s*सी/i.test(inputText)
        ? /hba1c|glycated|glycosylated/i
        : /glucose|sugar|शुगर/i;
      const matching = (report?.labResults || []).filter((item) =>
        requestedTest.test(item.testName),
      );
      const hindi = requestLanguage.startsWith('hi');
      const markedCritical = matching.some((item) =>
        /critical|panic|गंभीर/i.test(item.interpretation || ''),
      );
      const summary = matching.length
        ? hindi
          ? 'आपकी उपलब्ध रिपोर्ट में यह दर्ज है:'
          : 'Your available report records:'
        : hindi
          ? 'मुझे आपकी शुगर रिपोर्ट का परिणाम नहीं मिला। कृपया रिपोर्ट चुनें या साझा करें।'
          : 'I could not find your sugar report result. Please select or share the report.';
      const bullets = matching
        .slice(0, 5)
        .map(
          (item) =>
            `${item.testName}: ${item.value || (hindi ? 'मान उपलब्ध नहीं' : 'value unavailable')}${item.unit ? ` ${item.unit}` : ''}${item.referenceRange ? ` (${hindi ? 'रिपोर्ट की सीमा' : 'reported range'}: ${item.referenceRange})` : ''}`,
        );
      const guidance = markedCritical
        ? hindi
          ? 'रिपोर्ट में गंभीर परिणाम लिखा है। जल्द डॉक्टर से बात करें; तबीयत बिगड़ रही हो तो 108/112 पर कॉल करें।'
          : 'The report marks a result as critical. Speak to a doctor promptly; if you feel unwell or worse, call 108/112.'
        : hindi
          ? 'इन मानों का मतलब और इलाज के बारे में डॉक्टर या CHO से बात करें।'
          : 'Ask a doctor or CHO what these results mean for your care.';
      const content = {
        summary,
        [requestLanguage]: summary,
        ...(bullets.length
          ? {
              sections: [
                {
                  title: hindi ? 'रिपोर्ट के दर्ज मान' : 'Recorded results',
                  bullets,
                },
                { body: guidance },
              ],
            }
          : {}),
      };
      return {
        responseType: 'text',
        content,
        intent: IntentType.LAB_RESULT_QUERY,
        selectedAgent: 'clinical-record-facts',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // ─── Step 2: Gemini semantic classification ─────────────────────────────
    let classificationHistory = '';
    if (
      this.historyService &&
      !isPrescriptionExplanationTurn &&
      !isPrescriptionContextTurn
    ) {
      try {
        classificationHistory = await this.historyService.getRecentTurnHistory(
          sessionId,
          3,
          1000,
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Classification history retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const intentMeta = isPrescriptionContextTurn
      ? {
          intent:
            prescriptionContextResolution?.kind === 'INVESTIGATION_EDUCATION'
              ? IntentType.PRESCRIPTION_QUERY
              : IntentType.MEDICATION_QUERY,
          authorityCategory: AuthorityCategory.MEDICATION_ADHERENCE,
          confidence: 1,
          requiresClinicalContext: false,
          requiredRecordCategories: [],
          language: requestLanguage,
          safetySensitivity: 'HIGH' as const,
          classifiedBy: 'RULE_ENGINE' as const,
          knowledgeRequired: isPrescriptionGuidelineTurn,
          responseRequirements: [],
        }
      : traceContext && this.tracer
        ? await this.tracer.traceStep(
            traceContext,
            {
              name: 'intent_classification',
              runType: 'llm',
              provider: 'gemini',
              model: 'gemini-3.5-flash',
              necessity: 'NECESSARY',
              necessityReason:
                'Classifies patient intent and extracts semantic requirements.',
            },
            () =>
              this.intentClassifier.classifyIntent(
                resolvedInputText,
                requestLanguage,
                correlationId,
                classificationHistory,
              ),
          )
        : await this.intentClassifier.classifyIntent(
            resolvedInputText,
            requestLanguage,
            correlationId,
            classificationHistory,
          );

    // Patient conversation never changes prescription extraction or worker
    // verification state. A future authenticated worker API owns verification.

    if (
      intentMeta.authorityCategory === AuthorityCategory.CLINICAL_QUESTION ||
      intentMeta.authorityCategory === AuthorityCategory.POSSIBLE_EMERGENCY
    ) {
      const content = this.clinicalDeflectionContent(
        intentMeta.language,
        intentMeta.authorityCategory === AuthorityCategory.POSSIBLE_EMERGENCY,
        clinicalQuestionKind(inputText),
        inputText,
      );
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: identity.externalId,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'clinical_question_deflected',
        entityName: 'turn',
        entityId: sessionId,
        details: { authorityCategory: intentMeta.authorityCategory },
      });
      return {
        responseType: 'text',
        content,
        intent: intentMeta.intent,
        selectedAgent: 'authority-boundary',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    if (
      intentMeta.authorityCategory === AuthorityCategory.OUT_OF_SCOPE &&
      intentMeta.intent !== IntentType.GREETING
    ) {
      const content = this.outOfScopeContent(intentMeta.language);
      return {
        responseType: 'text',
        content,
        intent: intentMeta.intent,
        selectedAgent: 'authority-boundary',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    const authorityIntentMismatch =
      (intentMeta.authorityCategory ===
        AuthorityCategory.MEDICATION_ADHERENCE &&
        ![
          IntentType.ADHERENCE_QUERY,
          IntentType.MEDICATION_QUERY,
          IntentType.PRESCRIPTION_QUERY,
        ].includes(intentMeta.intent)) ||
      (intentMeta.authorityCategory === AuthorityCategory.FACILITY_NAVIGATION &&
        ![
          IntentType.FACILITY_QUERY,
          IntentType.REFERRAL_QUERY,
          IntentType.TELECONSULTATION_QUERY,
        ].includes(intentMeta.intent)) ||
      (intentMeta.authorityCategory === AuthorityCategory.SCHEME_ENTITLEMENT &&
        intentMeta.intent !== IntentType.GOVERNMENT_SCHEME_QUERY);

    // A low-confidence or unsupported provider result is a patient-facing
    // triage clarification, never an implicit route to a broad knowledge agent.
    if (
      authorityIntentMismatch ||
      intentMeta.authorityCategory === AuthorityCategory.UNCERTAIN ||
      intentMeta.intent === IntentType.UNKNOWN ||
      intentMeta.confidence < 0.65
    ) {
      const content = this.triageContent(intentMeta.language);
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: identity.externalId,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'ai_intent_triage_requested',
        entityName: 'turn',
        entityId: sessionId,
        details: {
          confidence: intentMeta.confidence,
          classifiedIntent: intentMeta.intent,
        },
      });

      if (traceContext && this.tracer) {
        await this.tracer.endTurn(traceContext, {
          responseType: 'text',
          content,
          intent: IntentType.UNKNOWN,
          selectedAgent: 'triage',
          safetyStatus: 'SAFE',
        });
      }

      return {
        responseType: 'text',
        content,
        intent: IntentType.UNKNOWN,
        selectedAgent: 'triage',
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // ─── Step 3: Agent Routing ──────────────────────────────────────────────
    const selectedAgent = this.agentRouter.selectAgent(intentMeta.intent);

    // A teleconsultation request is a governed DEMO navigation flow. It has no
    // clinical interpretation to generate, so it must not consume Gemini quota.
    // SafetyGate has already run above and therefore always retains precedence.
    if (intentMeta.intent === IntentType.TELECONSULTATION_QUERY) {
      const agentResult = await selectedAgent.process({
        sessionId,
        inputText: resolvedInputText,
        intentMetadata: intentMeta,
        correlationId,
      });
      const content =
        typeof agentResult.content === 'object'
          ? (agentResult.content as Record<string, any>)
          : { summary: String(agentResult.content) };

      if (traceContext && this.tracer) {
        this.tracer.recordStepDirectly(
          traceContext,
          {
            name: 'teleconsultation_governed_flow',
            runType: 'tool',
            necessity: 'NECESSARY',
            necessityReason:
              'Governed navigation flow executed deterministically, avoiding LLM generation cost.',
          },
          { latencyMs: 0 },
        );
        await this.tracer.endTurn(traceContext, {
          responseType: agentResult.responseType,
          content,
          intent: intentMeta.intent,
          selectedAgent: selectedAgent.agentId,
          safetyStatus: 'SAFE',
        });
      }

      return {
        responseType: agentResult.responseType,
        content,
        intent: intentMeta.intent,
        selectedAgent: selectedAgent.agentId,
        safetyStatus: 'SAFE',
        latencyMs: Date.now() - startTime,
      };
    }

    // ─── Step 3: Fetch Clinical Context (If Required) ────────────────────────
    let clinicalContext: ClinicalContext | null = null;
    let knowledgeSources: any[] = [];
    let knowledgePrompt = '';
    let normalizedQuery:
      ReturnType<KnowledgeQueryNormalizerService['normalize']> | undefined;
    let retrievalTrace: KnowledgeRetrievalResult | undefined;
    let facilityResults: Facility[] = [];
    let deterministicFacilityContent: Record<string, any> | null = null;
    let deterministicSchemeContent: Record<string, any> | null = null;
    let schemeResults: Scheme[] = [];
    let schemeFactsForEvaluation = '';

    // General knowledge is independent of patient-record availability. It is
    // always retrieved through the selected agent's constrained domain, never
    // used as a substitute for missing clinical records.
    if (
      !isPrescriptionExplanationTurn &&
      (!isPrescriptionContextTurn || isPrescriptionGuidelineTurn) &&
      this.knowledgeRetrievalService &&
      intentMeta.intent !== IntentType.GREETING &&
      intentMeta.intent !== IntentType.FACILITY_QUERY &&
      intentMeta.knowledgeRequired !== false
    ) {
      try {
        const targetDomain = AgentKnowledgeMapper.getTargetDomain(
          selectedAgent.agentId,
          intentMeta.intent,
        );
        let targetState: string | undefined;
        if (this.sessions && this.patientData) {
          const session = await this.sessions.findOne({
            where: { id: sessionId },
          });
          if (session) {
            const patient = await this.patientData.getPatientByReference(
              session.tenantId,
              session.subjectAbhaRef,
            );
            if (patient?.state) {
              if (/^himachal/i.test(patient.state))
                targetState = 'HIMACHAL_PRADESH';
              else if (/^haryana/i.test(patient.state)) targetState = 'HARYANA';
              else if (/^delhi/i.test(patient.state)) targetState = 'Delhi';
            }
          }
        }

        normalizedQuery = this.knowledgeQueryNormalizer?.normalize(
          resolvedInputText,
          intentMeta.language,
          intentMeta.intent,
          targetState,
        );
        const retrievalQuery = normalizedQuery?.query || resolvedInputText;

        const ragRes =
          traceContext && this.tracer
            ? await this.tracer.traceStep(
                traceContext,
                {
                  name: 'knowledge_retrieval',
                  runType: 'retriever',
                  provider: 'xenova',
                  model: 'all-MiniLM-L6-v2',
                  necessity: 'NECESSARY',
                  necessityReason:
                    'Vector retrieval of verified medical guidelines and IPHS standards.',
                  inputs: {
                    query: retrievalQuery,
                    domain: targetDomain,
                  },
                },
                () =>
                  this.knowledgeRetrievalService!.retrieve(retrievalQuery, {
                    domain: targetDomain,
                    category: normalizedQuery?.category,
                    maxResults: normalizedQuery?.maxResults,
                    intent: intentMeta.intent,
                    language: intentMeta.language,
                    tenantId: identity.tenantId,
                    state: normalizedQuery?.state || targetState,
                    stateMatchMode:
                      intentMeta.schemeInformationType === 'SCHEME_AVAILABILITY'
                        ? 'EXACT'
                        : 'INCLUDING_GLOBAL',
                    district: normalizedQuery?.district,
                    minRelevanceScore: 0.35,
                  }),
              )
            : await this.knowledgeRetrievalService.retrieve(retrievalQuery, {
                domain: targetDomain,
                category: normalizedQuery?.category,
                maxResults: normalizedQuery?.maxResults,
                intent: intentMeta.intent,
                language: intentMeta.language,
                tenantId: identity.tenantId,
                state: normalizedQuery?.state || targetState,
                // State-availability questions must discover state-authorised
                // sources, rather than allowing national material to displace
                // them in vector ranking. National availability remains supplied
                // through the structured Scheme source.
                stateMatchMode:
                  intentMeta.schemeInformationType === 'SCHEME_AVAILABILITY'
                    ? 'EXACT'
                    : 'INCLUDING_GLOBAL',
                district: normalizedQuery?.district,
                minRelevanceScore: 0.35,
              });
        knowledgePrompt = ragRes.formattedKnowledgePrompt;
        knowledgeSources = ragRes.sources;
        retrievalTrace = ragRes;
      } catch (kErr: unknown) {
        const kMsg = kErr instanceof Error ? kErr.message : String(kErr);
        this.logger.warn(`Knowledge retrieval failed: ${kMsg}`);
      }
    }

    // Facility discovery is tenant-scoped. Gemini extracts the requested
    // service and interprets governed IPHS level evidence; matching against
    // individual facility source fields and candidate ranking remain local.
    if (
      (intentMeta.intent === IntentType.FACILITY_QUERY ||
        intentMeta.intent === IntentType.REFERRAL_QUERY) &&
      (this.facilitySearch || this.facilityDirectory)
    ) {
      const location = await this.facilityLocation(
        sessionId,
        resolvedInputText,
        intentMeta.language,
      );
      const statedDistrict = intentMeta.requirements?.district;
      const statedState = intentMeta.requirements?.state;
      if (
        statedDistrict &&
        resolvedInputText
          .toLocaleLowerCase()
          .includes(statedDistrict.toLocaleLowerCase())
      ) {
        location.district = statedDistrict;
      }
      if (
        statedState &&
        resolvedInputText
          .toLocaleLowerCase()
          .includes(statedState.toLocaleLowerCase())
      ) {
        location.state = statedState;
      }
      // Facility constraints are extracted semantically by Gemini. We only use
      // source-backed filters; a requested service is never assumed available.
      const scheme = intentMeta.requirements?.scheme;
      const hospitalType = intentMeta.requirements?.facilityType;
      const requestedService = intentMeta.requirements?.service;
      const lowCostPreference =
        intentMeta.requirements?.costPreference === 'LOW_COST';
      if (location?.state || location?.district) {
        let serviceContext: FacilityServiceContext | undefined;
        let results: FacilitySearchResult[] = [];
        const commonFilters = {
          state: location.state,
          district: location.district,
          city: location.city,
          locality: location.locality,
          scheme,
          hospitalType,
          referralLevel: intentMeta.requirements?.referralLevel,
          referralLevels:
            intentMeta.intent === IntentType.REFERRAL_QUERY &&
            !intentMeta.requirements?.referralLevel
              ? (['SECONDARY', 'DISTRICT'] as Array<'SECONDARY' | 'DISTRICT'>)
              : undefined,
        };

        if (requestedService) {
          const iphsResolution = await this.resolveIphsLevelsForService(
            identity.tenantId,
            requestedService,
            intentMeta.language,
            location.state,
            correlationId,
          );
          const explicitlyRequestedLevel = intentMeta.requirements?.iphsLevel;
          const appropriateLevels =
            iphsResolution.evidenceStatus !== 'VERIFIED'
              ? []
              : explicitlyRequestedLevel
                ? iphsResolution.levels.filter(
                    (level) => level === explicitlyRequestedLevel,
                  )
                : iphsResolution.levels;
          serviceContext = {
            requestedService,
            appropriateIphsLevels: appropriateLevels,
            lowCostPreference,
            matchedSourceValues: [],
            iphsSources: iphsResolution.sources,
            iphsEvidenceStatus: iphsResolution.evidenceStatus,
          };

          if (
            iphsResolution.evidenceStatus === 'VERIFIED' &&
            appropriateLevels.length
          ) {
            // Service-specific recommendations are intentionally resolved
            // against the read-only NHA directory, never DB facilities or
            // facility_iphs_overlays. The IPHS result selects the level; this
            // directory only identifies real facilities at that level.
            const candidates = this.directoryFacilityResults(
              this.facilityDirectory?.find({
                state: location.state,
                district: location.district,
                ownership: hospitalType,
                preferOwnership: lowCostPreference ? 'PUBLIC' : undefined,
                scheme,
                iphsLevels: appropriateLevels,
                limit: 50,
              }) || [],
            );
            const sourceValues = collectSourceBackedServiceValues(candidates);
            const matchedSourceValues = matchSourceBackedServiceValues(
              [
                requestedService,
                ...(intentMeta.requirements?.serviceAliases || []),
              ],
              sourceValues,
            );
            serviceContext.matchedSourceValues = matchedSourceValues;
            results = prioritizeSourceBackedCandidates(
              candidates,
              matchedSourceValues,
            ).slice(0, 5);
          }
          // Never leave the patient with nowhere to go. Nearby facilities are
          // shown by location only, so no service level is claimed for them.
          if (!results.length && this.facilitySearch) {
            results = await this.facilitySearch.searchWithSchemes(
              identity.tenantId,
              { ...commonFilters, limit: 5 },
            );
            serviceContext.appropriateIphsLevels = [];
          }
        } else if (this.facilitySearch) {
          results = await this.facilitySearch.searchWithSchemes(
            identity.tenantId,
            {
              ...commonFilters,
              iphsLevel: intentMeta.requirements?.iphsLevel,
              limit: 5,
            },
          );
        }
        facilityResults = results.map(({ facility }) => facility);
        deterministicFacilityContent = this.facilityContent(
          results,
          location,
          intentMeta.language,
          scheme,
          false,
          serviceContext,
        );
      } else {
        const summary =
          intentMeta.language === 'hi'
            ? 'आप किस शहर या जिले में अस्पताल ढूंढ रहे हैं?'
            : 'Which city or district are you looking for a hospital in?';
        deterministicFacilityContent = {
          summary,
          [intentMeta.language]: summary,
          cards: [],
          facility_results: [],
          knowledge_sources: [],
        };
      }
    }

    if (
      intentMeta.intent === IntentType.GOVERNMENT_SCHEME_QUERY &&
      this.schemeService
    ) {
      const location =
        normalizedQuery ||
        this.knowledgeQueryNormalizer?.normalize(
          resolvedInputText,
          intentMeta.language,
          intentMeta.intent,
        );
      // The classifier's optional scheme constraint is semantic (and can be
      // resolved from retained context). It prevents unrelated active schemes
      // from being supplied as structured generation evidence.
      const resolver =
        this.terminologyResolver || new TerminologyResolverService();
      const canonicalSchemeQuery =
        intentMeta.schemeInformationType === 'SCHEME_AVAILABILITY'
          ? undefined
          : resolver.normalizeSchemeLookupQuery(
              intentMeta.requirements?.scheme,
              resolvedInputText,
            );
      schemeResults = await this.schemeService.list(identity.tenantId, {
        state: location?.state,
        // An availability request is an inventory of every authorised scheme
        // for the state; never let a retained or inferred scheme name narrow it.
        query: canonicalSchemeQuery,
      });
      if (!schemeResults.length && canonicalSchemeQuery) {
        const canonicalTarget =
          resolver.resolveCanonicalScheme(canonicalSchemeQuery);
        if (canonicalTarget) {
          const allStateSchemes = await this.schemeService.list(
            identity.tenantId,
            { state: location?.state },
          );
          schemeResults = allStateSchemes.filter(
            (s) =>
              resolver.resolveCanonicalScheme(
                `${s.schemeId || ''} ${s.name || ''}`,
              ) === canonicalTarget,
          );
        }
      }
      if (schemeResults.length) {
        const facts = this.scopedSchemeFacts(
          schemeResults,
          intentMeta.schemeInformationType,
        );
        schemeFactsForEvaluation = facts;
        knowledgePrompt += `\n\n[DETERMINISTIC SCHEME FACTS]\n${facts}`;
        knowledgeSources.push(
          ...schemeResults.map((scheme) => ({
            title: scheme.name,
            source: 'Structured scheme source',
            version: scheme.sourceVersion || 'Unknown',
            documentId: scheme.sourceDocumentId,
          })),
        );
      }
    }
    // A published, tenant-scoped scheme document is valid evidence even when
    // the separate structured Scheme table has no matching row.
    if (
      intentMeta.intent === IntentType.GOVERNMENT_SCHEME_QUERY &&
      !schemeResults.length &&
      !retrievalTrace?.matchedChunks.length
    ) {
      const hindi = intentMeta.language.startsWith('hi');
      const aadhaar = /aadhaar|aadhar|आधार/i.test(inputText);
      const operation = /operation|surgery|ऑपरेशन|सर्जरी/i.test(inputText);
      const summary = aadhaar
        ? hindi
          ? 'सिर्फ़ आधार कार्ड से मैं नहीं बता सकती कि आयुष्मान योजना आपको मिलेगी या नहीं।'
          : 'I cannot establish your Ayushman scheme eligibility from Aadhaar possession alone.'
        : operation
          ? hindi
            ? 'किस सरकारी योजना से ऑपरेशन में मदद मिल सकती है, इसकी पुष्टि यहाँ उपलब्ध स्वीकृत जानकारी से नहीं हो रही।'
            : 'The approved information available here does not confirm which government scheme could help with your operation.'
          : hindi
            ? 'इस योजना की पक्की जानकारी अभी मेरे पास नहीं है, इसलिए मैं इसके फ़ायदे या पात्रता नहीं बता सकती।'
            : 'Approved information for this scheme is not available here, so I cannot confirm its benefits or eligibility.';
      const next = operation
        ? hindi
          ? 'आप किस शहर में हैं और किस तरह का ऑपरेशन बताया गया है? इन बातों के साथ सरकारी योजना हेल्पडेस्क पर पात्रता जाँचें।'
          : 'Which city are you in, and what operation was recommended? Check eligibility with an official scheme help desk using those details.'
        : hindi
          ? 'पात्रता और इलाज की सुविधा सरकारी योजना हेल्पडेस्क से जाँचें।'
          : 'Check eligibility and available care with an official scheme help desk.';
      deterministicSchemeContent = {
        summary,
        [intentMeta.language]: summary,
        sections: [{ bullets: [next] }],
      };
    }

    let formattedContext = ClinicalAiContextBuilder.formatPromptContext(
      ClinicalAiContextBuilder.buildMinimizedContext(null, intentMeta.language),
      knowledgePrompt,
    );

    const consentId = vdaConsentArtifactId || 'dev-consent-001';
    if (
      !isPrescriptionExplanationTurn &&
      !isPrescriptionContextTurn &&
      intentMeta.requiresClinicalContext &&
      consentId
    ) {
      try {
        await this.auditService.logEvent({
          tenantId: identity.tenantId,
          subjectAbhaRef: identity.externalId,
          actingPrincipal: identity.externalId,
          correlationId,
          action: 'ai_context_requested',
          entityName: 'clinical_context',
          entityId: sessionId,
          details: {
            categories: intentMeta.requiredRecordCategories,
          },
        });

        clinicalContext =
          traceContext && this.tracer
            ? await this.tracer.traceStep(
                traceContext,
                {
                  name: 'clinical_context_retrieval',
                  runType: 'tool',
                  provider: 'abdm',
                  necessity: 'NECESSARY',
                  necessityReason:
                    'Retrieves authorized patient health records from ABDM.',
                  inputs: {
                    categories: intentMeta.requiredRecordCategories,
                  },
                },
                () =>
                  this.clinicalContextService.buildContext({
                    sessionId,
                    tenantId: identity.tenantId,
                    subjectAbhaRef: identity.externalId,
                    vdaConsentArtifactId: consentId,
                    intent: intentMeta.intent,
                    requiredRecordCategories:
                      intentMeta.requiredRecordCategories,
                    correlationId,
                  }),
              )
            : await this.clinicalContextService.buildContext({
                sessionId,
                tenantId: identity.tenantId,
                subjectAbhaRef: identity.externalId,
                vdaConsentArtifactId: consentId,
                intent: intentMeta.intent,
                requiredRecordCategories: intentMeta.requiredRecordCategories,
                correlationId,
              });

        const minimized = ClinicalAiContextBuilder.buildMinimizedContext({
          sessionId,
          subjectRef: identity.externalId,
          intent: intentMeta.intent,
          medications: clinicalContext.medications,
          labResults: clinicalContext.labResults,
          diagnoses: clinicalContext.diagnoses,
          allergies: clinicalContext.allergies,
          carePlans: clinicalContext.carePlans,
          unavailableCategories: clinicalContext.unavailableCategories || [],
          partialResult: clinicalContext.partialResult || false,
          retrievalTimestamp: clinicalContext.retrievalTimestamp || new Date(),
          consentVersion: clinicalContext.consentVersion || 'v1.0',
        });

        formattedContext = ClinicalAiContextBuilder.formatPromptContext(
          minimized,
          knowledgePrompt,
        );
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : '';
        this.logger.error(`ClinicalContext retrieval failed: ${errMsg}`, stack);
      }
    }

    // ─── Step 4: Retrieve Bounded Conversation History ───────────────────────
    const historyPrompt = isPrescriptionExplanationTurn
      ? ''
      : classificationHistory;

    // ─── Step 5: Modular Domain-Specific System Prompt & Safety Directives ───
    const systemPrompt = ModularPromptBuilder.buildSystemPrompt({
      language: intentMeta.language,
      intent: intentMeta.intent,
      schemeInformationType: intentMeta.schemeInformationType,
      responseRequirements: intentMeta.responseRequirements,
      requiresClinicalContext: intentMeta.requiresClinicalContext,
      isPrescriptionExplanationTurn,
      isPrescriptionContextGenerationTurn,
    });

    let userPrompt = '';
    if (isPrescriptionContextGenerationTurn) {
      // No identity, session, history, raw OCR, or raw patient input can enter
      // this isolated prompt.
      userPrompt = '[PRESCRIPTION EDUCATION PRIVACY BOUNDARY]\n';
    } else if (authorizedPatient) {
      userPrompt += `[AUTHENTICATED PATIENT IDENTITY — STRICT ACCESS CONTROL (RBAC)]
Authorized Patient Name: ${authorizedPatient.name}
Age: ${authorizedPatient.age ?? 'Not specified'}
Gender: ${authorizedPatient.gender ?? 'Not specified'}
Selected Profile Reference: ${authorizedPatientRef}
RBAC POLICY: All clinical context, medications, and records in this prompt belong EXCLUSIVELY to ${authorizedPatient.name}. Address only ${authorizedPatient.name}. If the user asserts a different identity or asks for someone else's personal records, politely refuse and instruct them to switch profiles in the app.
[/AUTHENTICATED PATIENT IDENTITY]\n\n`;
    }
    if (!isPrescriptionContextGenerationTurn)
      userPrompt += `${formattedContext}`;

    // Inject uploaded prescription context if available
    if (
      !isPrescriptionContextGenerationTurn &&
      latestPrescription &&
      latestPrescription.medications?.length
    ) {
      const rxMeds = latestPrescription.medications
        .map((m: any) => {
          const name = m.medicationName || m.normalizedName || 'Unknown';
          const strength = m.strength || m.dosage || '';
          const freq = m.frequency || '';
          const duration = m.duration || '';
          const instructions = m.instructions || '';
          return `- ${name}${strength ? `, ${strength}` : ''}${freq ? `, ${freq}` : ''}${duration ? `, ${duration}` : ''}${instructions ? `, ${instructions}` : ''}`;
        })
        .join('\n');

      const rxTests =
        latestPrescription.investigations
          ?.map((t: any) => `- ${t.rawName || t.normalizedName || 'Unknown'}`)
          .filter(Boolean)
          .join('\n') || '';

      const rxBlock = `\n\n[UPLOADED PRESCRIPTION CONTEXT]
Medicines from this uploaded prescription only:
${rxMeds}${rxTests ? `\nInvestigations/Tests from uploaded prescription:\n${rxTests}` : ''}
[/UPLOADED PRESCRIPTION CONTEXT]`;

      userPrompt += rxBlock;
    }

    if (isPrescriptionContextGenerationTurn && prescriptionContextResolution) {
      if (prescriptionContextResolution.kind === 'MEDICINE_EDUCATION') {
        userPrompt += `[SANITIZED MEDICINE EDUCATION]\nmedicineName: ${prescriptionContextResolution.medicine.name}\nquestion: ${prescriptionContextResolution.question}\n[/SANITIZED MEDICINE EDUCATION]`;
      } else if (
        prescriptionContextResolution.kind === 'INVESTIGATION_EDUCATION'
      ) {
        userPrompt += `[SANITIZED INVESTIGATION EDUCATION]\ninvestigationName: ${prescriptionContextResolution.investigation.name}\nquestion: ${prescriptionContextResolution.question}\n[/SANITIZED INVESTIGATION EDUCATION]`;
      } else if (prescriptionContextResolution.kind === 'MEDICINE_FOR_BP') {
        userPrompt += `[SANITIZED MEDICINE EDUCATION]\nmedicineNames: ${prescriptionContextResolution.medicines.map((medicine) => medicine.name).join(', ')}\nquestion: ${prescriptionContextResolution.question}\n[/SANITIZED MEDICINE EDUCATION]`;
      }
    }

    if (!isPrescriptionContextGenerationTurn && historyPrompt) {
      userPrompt += `\n\n${historyPrompt}`;
    }
    if (!isPrescriptionContextGenerationTurn)
      userPrompt += `\n\n[PATIENT QUERY]\n${resolvedInputText}`;

    let aiResultText = '';
    let finalResponseType = 'text';
    let contentObj: Record<string, any> = {};
    // Check if patient asks for dosage/medication changes explicitly
    const lowerInput = resolvedInputText.toLowerCase();
    const asksMedChange =
      /बंद कर दूँ|दवाई रोक|dose change|stop medicine|stop taking|double dose|increase dose|decrease dose/i.test(
        lowerInput,
      );

    if (deterministicSchemeContent) {
      aiResultText = deterministicSchemeContent.summary;
      contentObj = deterministicSchemeContent;
    } else if (deterministicFacilityContent) {
      aiResultText = deterministicFacilityContent.summary;
      contentObj = deterministicFacilityContent;
      if (traceContext && this.tracer) {
        this.tracer.recordStepDirectly(
          traceContext,
          {
            name: 'deterministic_facility_content',
            runType: 'tool',
            necessity: 'NECESSARY',
            necessityReason:
              'Handled via deterministic facility matcher, saving LLM tokens',
          },
          { latencyMs: 0 },
        );
      }
    } else if (asksMedChange) {
      aiResultText =
        intentMeta.language === 'hi'
          ? 'कृपया अपनी दवा रोकने या खुराक बदलने से पहले अपने डॉक्टर या फार्मासिस्ट से परामर्श लें।'
          : 'Please consult your prescribing clinician or pharmacist before stopping or changing any medication dosage.';
      contentObj = {
        summary: aiResultText,
        [intentMeta.language]: aiResultText,
      };
      if (traceContext && this.tracer) {
        this.tracer.recordStepDirectly(
          traceContext,
          {
            name: 'medication_change_warning',
            runType: 'tool',
            necessity: 'NECESSARY',
            necessityReason:
              'Deterministic medication dosage change safety warning, avoiding LLM generation cost',
          },
          { latencyMs: 0 },
        );
      }
    } else {
      try {
        if (!isPrescriptionContextGenerationTurn) {
          this.logger.log(
            `[RagPromptTelemetry] intent=${intentMeta.intent} agent=${selectedAgent.agentId} domain=${AgentKnowledgeMapper.getTargetDomain(selectedAgent.agentId, intentMeta.intent) || 'NONE'} chunks=${knowledgeSources.length} knowledge_chars=${knowledgePrompt.length} clinical_context_chars=${formattedContext.length - knowledgePrompt.length} history_chars=${historyPrompt.length} patient_query_chars=${resolvedInputText.length} total_prompt_chars=${userPrompt.length}`,
          );
        }
        const aiResponse =
          traceContext && this.tracer
            ? await this.tracer.traceStep(
                traceContext,
                {
                  name: 'patient_response_generation',
                  runType: 'llm',
                  provider: 'gemini',
                  model: 'gemini-3.5-flash',
                  necessity: 'NECESSARY',
                  necessityReason:
                    'Primary LLM synthesis of patient guidance conforming to JSON schema contract.',
                  inputs: { promptLength: userPrompt.length },
                },
                () =>
                  this.aiProvider.generate(userPrompt, {
                    systemPrompt,
                    correlationId,
                    temperature: 0.2,
                    maxTokens: 1024,
                    responseFormat: 'json',
                    thinkingLevel: 'MINIMAL',
                    telemetryLabel: 'PATIENT_RESPONSE',
                  }),
              )
            : await this.aiProvider.generate(userPrompt, {
                systemPrompt,
                correlationId,
                temperature: 0.2,
                maxTokens: 1024,
                responseFormat: 'json',
                thinkingLevel: 'MINIMAL',
                telemetryLabel: 'PATIENT_RESPONSE',
              });
        let generated = this.responseFormatter?.normalizeGeneratedContent(
          aiResponse.json,
        );
        if (
          generated &&
          !this.responseFormatter?.meetsResponseRequirements(
            generated,
            intentMeta.responseRequirements || [],
          )
        ) {
          generated = null;
        }
        if (!generated) {
          this.logger.warn(
            `[PatientResponseContract] correlationId=${correlationId} intent=${intentMeta.intent} agent=${selectedAgent.agentId} parser=${aiResponse.json ? 'parsed' : 'unparseable_json'} response_chars=${aiResponse.text.length} validation=${aiResponse.json ? 'missing_or_invalid_summary' : 'json_unavailable'}`,
          );
          const retryResponse =
            traceContext && this.tracer
              ? await this.tracer.traceStep(
                  traceContext,
                  {
                    name: 'patient_response_retry',
                    runType: 'llm',
                    provider: 'gemini',
                    model: 'gemini-3.5-flash',
                    isRetry: true,
                    necessity: 'PREVENTABLE_RETRY',
                    necessityReason:
                      'Initial LLM response breached JSON contract schema; retry was preventable by strict schema enforcement.',
                  },
                  () =>
                    this.aiProvider.generate(userPrompt, {
                      systemPrompt: `${systemPrompt}\nYour previous output was invalid. Return only valid concise JSON matching the contract.`,
                      correlationId,
                      temperature: 0,
                      maxTokens: 1024,
                      responseFormat: 'json',
                      thinkingLevel: 'MINIMAL',
                      telemetryLabel: 'PATIENT_RESPONSE_RETRY',
                    }),
                )
              : await this.aiProvider.generate(userPrompt, {
                  systemPrompt: `${systemPrompt}\nYour previous output was invalid. Return only valid concise JSON matching the contract.`,
                  correlationId,
                  temperature: 0,
                  maxTokens: 1024,
                  responseFormat: 'json',
                  thinkingLevel: 'MINIMAL',
                  telemetryLabel: 'PATIENT_RESPONSE_RETRY',
                });
          generated = this.responseFormatter?.normalizeGeneratedContent(
            retryResponse.json,
          );
          if (
            generated &&
            !this.responseFormatter?.meetsResponseRequirements(
              generated,
              intentMeta.responseRequirements || [],
            )
          ) {
            generated = null;
          }
          if (!generated) {
            this.logger.warn(
              `[PatientResponseContract] correlationId=${correlationId} intent=${intentMeta.intent} agent=${selectedAgent.agentId} parser=${retryResponse.json ? 'parsed' : 'unparseable_json'} response_chars=${retryResponse.text.length} validation=${retryResponse.json ? 'missing_or_invalid_summary' : 'json_unavailable'} retry=true`,
            );
          }
        }
        if (!generated) {
          throw new Error('PATIENT_RESPONSE_CONTRACT_INVALID');
        }
        aiResultText =
          this.responseFormatter?.patientFacingText(generated) ||
          generated.summary;
        contentObj = {
          ...generated,
          patient_text: aiResultText,
          [intentMeta.language]: aiResultText,
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : '';
        this.logger.error(
          `AI Provider execution failed correlationId=${correlationId} intent=${intentMeta.intent} layer=ai_orchestrator errorType=${err instanceof Error ? err.name : 'Unknown'} errorMessage=${errMsg}`,
          errStack,
        );
        throw new ServiceUnavailableException('PATIENT_RESPONSE_UNAVAILABLE');
      }
    }

    // ─── Step 6: Language Normalization (Sarvam / Dev) ──────────────────────
    let finalOutputText = aiResultText;
    if (intentMeta.language.startsWith('hi')) {
      finalOutputText =
        traceContext && this.tracer
          ? await this.tracer.traceStep(
              traceContext,
              {
                name: 'language_normalization',
                runType: 'tool',
                provider: 'rule-engine',
                model: 'in-process-whitespace-normalizer',
                necessity: 'NECESSARY',
                necessityReason:
                  'In-process whitespace normalization; no Sarvam API request is made.',
              },
              () => this.languageProvider.normalizeIndianText(aiResultText),
            )
          : await this.languageProvider.normalizeIndianText(aiResultText);
    }

    // ─── Step 7: Dedicated Post-Generation Safety Validation ─────────────────
    const postSafetyResult =
      traceContext && this.tracer
        ? await this.tracer.traceStep(
            traceContext,
            {
              name: 'safety_gate_post_evaluation',
              runType: 'tool',
              provider: 'safety-gate',
              necessity: 'NECESSARY',
              necessityReason:
                'Validates synthesized output against clinical safety guidelines.',
            },
            () =>
              this.safetyGate.evaluateSafety(
                finalOutputText,
                correlationId,
                intentMeta.language,
              ),
          )
        : await this.safetyGate.evaluateSafety(
            finalOutputText,
            correlationId,
            intentMeta.language,
          );

    let safetyStatus = 'SAFE';
    if (postSafetyResult.status === 'ESCALATION_REQUIRED') {
      // Emergency presentation is reserved for the deterministic pre-generation
      // SafetyGate result on the current patient input. A generated answer that
      // fails output validation is withheld, but must not create an emergency UI.
      safetyStatus = 'WITHHELD_QUALITY';
      finalResponseType = 'text';
      const withheldMessage = intentMeta.language.startsWith('hi')
        ? NO_RELIABLE_ANSWER_HI
        : NO_RELIABLE_ANSWER_EN;
      contentObj = {
        summary: withheldMessage,
        [intentMeta.language]: withheldMessage,
      };
    } else if (postSafetyResult.status === 'WITHHOLD') {
      safetyStatus = 'WITHHELD_QUALITY';
      finalResponseType = 'text';
      contentObj = {
        en:
          postSafetyResult.patientSafeMessage ||
          'Response withheld due to safety policy.',
        hi:
          postSafetyResult.patientSafeMessage ||
          'सुरक्षा नीतियों के कारण प्रतिक्रिया रोक दी गई है।',
      };
    } else {
      // SAFE
      if (Object.keys(contentObj).length === 0) {
        contentObj = {
          [intentMeta.language]: finalOutputText,
        };
      } else {
        if (!contentObj[intentMeta.language]) {
          contentObj[intentMeta.language] = finalOutputText;
        }
      }
      if (facilityResults.length > 0 && !deterministicFacilityContent) {
        contentObj['facility_results'] = facilityResults.map((facility) => ({
          name: facility.name,
          state: facility.state,
          district: facility.district,
          pmjayStatus: facility.pmjayStatus,
          hospitalType: facility.hospitalType,
          contactNumber: facility.contactNumber,
          distanceKm: null,
          sourceDocumentId: facility.sourceDocumentId,
        }));
      }
      if (schemeResults.length > 0) {
        contentObj['scheme_results'] = schemeResults.map((scheme) => ({
          name: scheme.name,
          geographyScope: scheme.geographyScope,
          state: scheme.state,
          benefitsDescription: scheme.benefitsDescription,
          coverageInformation: scheme.coverageInformation,
          requiredDocuments: scheme.requiredDocuments,
          officialUrl: scheme.officialUrl,
          helpline: scheme.helpline,
          eligibilityStatus: 'ELIGIBILITY_CHECK_REQUIRED',
          sourceDocumentId: scheme.sourceDocumentId,
        }));
      }
    }

    // ─── Step 7.5: Layer 2 Inline RAGAS Evaluation Circuit Breaker ──────────
    let ragasScores: {
      faithfulness?: number;
      answerRelevancy?: number;
      contextPrecision?: number;
    } = {};

    if (
      safetyStatus === 'SAFE' &&
      retrievalTrace &&
      retrievalTrace.matchedChunks &&
      retrievalTrace.matchedChunks.length > 0 &&
      this.ragasGate
    ) {
      const chunkTexts = retrievalTrace.matchedChunks
        .map((c) => c.content || c.title)
        .filter(Boolean);
      // Scheme generation also receives the existing structured Scheme facts.
      // Include that authorised evidence in verification so supported PM-JAY
      // claims are not incorrectly treated as ungrounded.
      if (schemeFactsForEvaluation) chunkTexts.push(schemeFactsForEvaluation);

      const ragasResult = await this.ragasGate.evaluateTurn(
        inputText,
        finalOutputText,
        chunkTexts,
        correlationId,
      );

      ragasScores = {
        faithfulness: ragasResult.faithfulnessScore,
        answerRelevancy: ragasResult.answerRelevancyScore,
        contextPrecision: ragasResult.contextPrecisionScore,
      };

      if (!ragasResult.passed) {
        this.logger.warn(
          `[RAGAS_CIRCUIT_BREAKER] Threshold breach correlationId=${correlationId} faithfulness=${ragasResult.faithfulnessScore} relevancy=${ragasResult.answerRelevancyScore} precision=${ragasResult.contextPrecisionScore} violation=${ragasResult.clinicalViolationDetected} reason=${ragasResult.reason}`,
        );

        safetyStatus = 'WITHHELD_BY_RAGAS';
        // RAG quality withholding is not an emergency red-flag result.
        finalResponseType = 'text';
        const holdingMsg = intentMeta.language.startsWith('hi')
          ? NO_RELIABLE_ANSWER_HI
          : NO_RELIABLE_ANSWER_EN;

        contentObj = {
          reason:
            ragasResult.reason ||
            'Faithfulness or relevancy threshold breach against clinical guidelines.',
          summary: holdingMsg,
          unsupported_claims: ragasResult.unsupportedClaims,
          ragas_scores: {
            faithfulness: ragasResult.faithfulnessScore,
            answerRelevancy: ragasResult.answerRelevancyScore,
            contextPrecision: ragasResult.contextPrecisionScore,
          },
          [intentMeta.language]: holdingMsg,
          en: NO_RELIABLE_ANSWER_EN,
        };
        finalOutputText = holdingMsg;
      }
    }

    // Clinical review: a scheme answer never opens with "हाँ"/"Yes", since
    // schemes are only for eligible people; the prompt alone did not hold.
    if (
      intentMeta.intent === IntentType.GOVERNMENT_SCHEME_QUERY &&
      typeof contentObj?.summary === 'string'
    ) {
      const trimmed = contentObj.summary.replace(
        /^\s*(?:हाँ|हां|yes)\s*[,।!.]?\s*/iu,
        '',
      );
      if (trimmed && trimmed !== contentObj.summary) {
        contentObj = {
          ...contentObj,
          summary: trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1),
        };
      }
    }

    // The normalizer marks Ayushman card application questions with this category.
    if (
      intentMeta.intent === IntentType.GOVERNMENT_SCHEME_QUERY &&
      normalizedQuery?.category === 'pmjay_operations' &&
      (safetyStatus === 'SAFE' || safetyStatus === 'WITHHELD_BY_RAGAS')
    ) {
      contentObj = this.withBothCardApplicationRoutes(
        contentObj,
        intentMeta.language.startsWith('hi'),
        safetyStatus === 'WITHHELD_BY_RAGAS',
        /vay\s*vandana|वय\s*वंदना|\b70\s*\+|\bsenior\s*citizen|बुजुर्ग|बुज़ुर्ग/iu.test(
          inputText,
        ),
      );
    }

    // ─── Step 8: Apply Response Formatter for Structured Cards ─────────────
    if (retrievalTrace?.matchedChunks.length || schemeResults.length) {
      contentObj['provenance'] = 'KNOWLEDGE';
    } else if (clinicalContext) {
      contentObj['provenance'] = 'FHIR_R4';
    }

    if (this.responseFormatter) {
      const formatted = this.responseFormatter.formatResponse({
        responseType: finalResponseType,
        content: contentObj,
        intent: intentMeta.intent,
        selectedAgent: selectedAgent.agentId,
        safetyStatus,
        clinicalContext,
        language: intentMeta.language,
        // The privacy-isolated medicine-education flow must never pass the
        // patient-authored query to downstream formatters.
        inputText: isPrescriptionContextGenerationTurn
          ? resolvedInputText
          : inputText,
      });
      contentObj = formatted.content;
      finalResponseType = formatted.response_type;
    }

    if (isPrescriptionContextGenerationTurn && prescriptionContextResolution) {
      if (prescriptionContextResolution.kind === 'MEDICINE_EDUCATION') {
        await this.prescriptionSessionContext.setLastReferencedMedicine(
          sessionId,
          prescriptionContextResolution.medicine.name,
        );
      } else if (
        prescriptionContextResolution.kind === 'INVESTIGATION_EDUCATION'
      ) {
        await this.prescriptionSessionContext.setLastReferencedInvestigation(
          sessionId,
          prescriptionContextResolution.investigation.name,
        );
      }
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: identity.externalId,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'prescription_session_context_used',
        entityName: 'turn',
        entityId: sessionId,
        details: {
          contextType: prescriptionContextResolution.kind,
          contextFieldCount:
            prescriptionContextResolution.kind === 'MEDICINE_FOR_BP'
              ? prescriptionContextResolution.medicines.length + 1
              : 2,
          piiRedacted: true,
          telemetry: 'disabled',
        },
      });
    }

    await this.auditService.logEvent({
      tenantId: identity.tenantId,
      subjectAbhaRef: identity.externalId,
      actingPrincipal: identity.externalId,
      correlationId,
      action: 'ai_response_generated',
      entityName: 'turn',
      entityId: sessionId,
      details: {
        intent: intentMeta.intent,
        selectedAgent: selectedAgent.agentId,
        safetyStatus,
        language: intentMeta.language,
      },
    });

    if (retrievalTrace && this.ragEvaluation) {
      try {
        await this.ragEvaluation.recordRetrieval({
          tenantId: identity.tenantId,
          query: inputText,
          normalizedQuery: normalizedQuery?.query,
          intent: intentMeta.intent,
          agent: selectedAgent.agentId,
          language: intentMeta.language,
          domain: AgentKnowledgeMapper.getTargetDomain(
            selectedAgent.agentId,
            intentMeta.intent,
          ),
          state: normalizedQuery?.state,
          response: finalOutputText,
          result: retrievalTrace,
          faithfulness: ragasScores.faithfulness,
          answerRelevancy: ragasScores.answerRelevancy,
          contextPrecision: ragasScores.contextPrecision,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `RAG evaluation trace failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (traceContext && this.tracer) {
      await this.tracer.endTurn(traceContext, {
        responseType: finalResponseType,
        content: contentObj,
        intent: intentMeta.intent,
        selectedAgent: selectedAgent.agentId,
        safetyStatus,
      });
    }

    const latencyMs = Date.now() - startTime;

    return {
      responseType: finalResponseType,
      content: contentObj,
      intent: intentMeta.intent,
      selectedAgent: selectedAgent.agentId,
      safetyStatus,
      latencyMs,
    };
  }
}
