import { AiOrchestratorService } from './ai-orchestrator.service';
import { IntentType } from '../intents/intent.types';
import { HostIdentity } from '../../auth/host-identity.context';
import { ConversationResponseFormatter } from '../../conversations/formatters/conversation-response.formatter';

describe('AiOrchestratorService — Patient Identity & RBAC Guard', () => {
  let orchestrator: AiOrchestratorService;
  let mockAiProvider: any;
  let mockLanguageProvider: any;
  let mockIntentClassifier: any;
  let mockAgentRouter: any;
  let mockClinicalContextService: any;
  let mockSafetyGate: any;
  let mockAuditService: any;
  let mockSessions: any;
  let mockPatientData: any;

  const mockIdentity: HostIdentity = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    partnerId: 'test-partner',
    externalId: 'ext-user-001',
    subjectAbhaRef: 'synthetic:vijay-chauhan',
    scopes: ['PATIENT'],
  };

  const mockPatientRecord = {
    id: 'vijay-chauhan',
    name: 'Vijay Chauhan',
    age: 48,
    gender: 'MALE',
    language: 'hi',
    state: 'HIMACHAL_PRADESH',
    district: 'KANGRA',
    source: 'synthetic' as const,
    clinicalProfile: {
      diagnoses: [],
      medications: [],
      labResults: [],
      allergies: [],
      prescriptions: [],
      carePlans: [],
      encounters: [],
    },
  };

  beforeEach(() => {
    mockAiProvider = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify({ summary: 'Normal response' }),
        json: { summary: 'Normal response' },
      }),
    };
    mockLanguageProvider = {
      detectLanguage: jest.fn().mockResolvedValue('hi'),
      normalizeIndianText: jest.fn().mockImplementation((text) => Promise.resolve(text)),
    };
    mockIntentClassifier = {
      classifyIntent: jest.fn().mockResolvedValue({
        intent: IntentType.MEDICATION_QUERY,
        confidence: 0.95,
        language: 'hi',
        requiresClinicalContext: true,
        requiredRecordCategories: ['MEDICATION'],
      }),
    };
    mockAgentRouter = {
      selectAgent: jest.fn().mockReturnValue({ agentId: 'medication-agent', name: 'Medication Agent' }),
      route: jest.fn().mockReturnValue('record-agent'),
    };
    mockClinicalContextService = {
      buildContext: jest.fn().mockResolvedValue({
        sessionId: 'session-001',
        medications: [],
        labResults: [],
        diagnoses: [],
      }),
    };
    mockSafetyGate = {
      evaluateSafety: jest.fn().mockResolvedValue({
        status: 'SAFE',
        violations: [],
      }),
    };
    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };
    mockSessions = {
      findOne: jest.fn().mockResolvedValue({
        id: 'session-001',
        tenantId: mockIdentity.tenantId,
        subjectAbhaRef: 'synthetic:vijay-chauhan',
      }),
    };
    mockPatientData = {
      getPatientByReference: jest.fn().mockResolvedValue(mockPatientRecord),
      getPatient: jest.fn().mockResolvedValue(mockPatientRecord),
      getPatients: jest.fn().mockResolvedValue([mockPatientRecord]),
      getClinicalContext: jest.fn().mockResolvedValue(mockPatientRecord.clinicalProfile),
    };

    orchestrator = new AiOrchestratorService(
      mockAiProvider,
      mockLanguageProvider,
      mockIntentClassifier,
      mockAgentRouter,
      mockClinicalContextService,
      mockSafetyGate,
      mockAuditService,
      undefined, // historyService
      new ConversationResponseFormatter(), // responseFormatter
      undefined, // knowledgeRetrievalService
      undefined, // knowledgeQueryNormalizer
      undefined, // facilitySearch
      undefined, // facilityDirectory
      undefined, // schemeService
      mockSessions,
      undefined, // prescriptions
      mockPatientData,
      undefined, // conversationTurns
      undefined, // ragEvaluation
      undefined, // tracer
    );
  });

  describe('detectIdentityMismatch unit behavior', () => {
    const detect = (input: string, authorizedName: string) =>
      (orchestrator as any).detectIdentityMismatch(input, authorizedName);

    it('returns isMismatch=false when no identity assertion is in the query', () => {
      expect(detect('मेरी दवाइयाँ बताओ', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('What is my blood sugar?', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('कल डॉक्टर के पास जाना है', 'Vijay Chauhan').isMismatch).toBe(false);
    });

    it('returns isMismatch=false when user asserts their own authorized name', () => {
      expect(detect('Main Vijay hoon, meri dawai batao', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('Main Vijay Chauhan hoon', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('Mera naam Vijay hai', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('I am Vijay', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('I am Vijay Chauhan, check my lab report', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('Call me Vijay', 'Vijay Chauhan').isMismatch).toBe(false);
    });

    it('returns isMismatch=false for non-name state/symptom declarations', () => {
      expect(detect('Main theek hoon', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('Main bimar hoon', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('I am feeling sick today', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('I am diabetic, can I eat sweets?', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('I am pregnant', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('I am having chest pain', 'Vijay Chauhan').isMismatch).toBe(false);
      expect(detect('I am ok now', 'Vijay Chauhan').isMismatch).toBe(false);
    });

    it('returns isMismatch=true when user asserts a different identity in Hindi', () => {
      const res = detect('Main Sunita hoon, meri dawai batao', 'Vijay Chauhan');
      expect(res.isMismatch).toBe(true);
      expect(res.claimedName).toBe('Sunita');
      expect(res.authorizedName).toBe('Vijay Chauhan');

      const res2 = detect('Mera naam Sunita Devi hai', 'Vijay Chauhan');
      expect(res2.isMismatch).toBe(true);
      expect(res2.claimedName).toBe('Sunita Devi');
    });

    it('returns isMismatch=true when user asserts a different identity in English', () => {
      const res = detect('I am Sunita, what are my prescriptions?', 'Vijay Chauhan');
      expect(res.isMismatch).toBe(true);
      expect(res.claimedName).toBe('Sunita');

      const res2 = detect('My name is Rahul Sharma', 'Vijay Chauhan');
      expect(res2.isMismatch).toBe(true);
      expect(res2.claimedName).toBe('Rahul Sharma');

      const res3 = detect('Switch to Sunita', 'Vijay Chauhan');
      expect(res3.isMismatch).toBe(true);
      expect(res3.claimedName).toBe('Sunita');
    });
  });

  describe('orchestrateTurn with RBAC enforcement', () => {
    it('blocks persona switch and returns IDENTITY_ACCESS_RESTRICTED in Hindi', async () => {
      const result = await orchestrator.orchestrateTurn({
        sessionId: 'session-001',
        inputText: 'Main Sunita hoon, meri dawai batao',
        correlationId: 'corr-rbac-001',
        identity: mockIdentity,
        vdaConsentArtifactId: 'consent-001',
        language: 'hi',
      });

      expect(result.safetyStatus).toBe('IDENTITY_ACCESS_RESTRICTED');
      expect(result.selectedAgent).toBe('rbac-identity-guard');
      expect(result.responseType).toBe('text');
      expect(result.content.summary).toContain('Vijay Chauhan');
      expect(result.content.summary).toContain('Sunita');
      expect(result.content.actions).toEqual([
        { label: 'प्रोफ़ाइल बदलें', action: 'SWITCH_PROFILE' },
      ]);

      // Assert LLM and context builders were NOT invoked (data leakage prevented)
      expect(mockIntentClassifier.classifyIntent).not.toHaveBeenCalled();
      expect(mockClinicalContextService.buildContext).not.toHaveBeenCalled();
      expect(mockAiProvider.generate).not.toHaveBeenCalled();
    });

    it('blocks persona switch and returns IDENTITY_ACCESS_RESTRICTED in English', async () => {
      const result = await orchestrator.orchestrateTurn({
        sessionId: 'session-001',
        inputText: 'I am Sunita, give me my prescriptions',
        correlationId: 'corr-rbac-002',
        identity: mockIdentity,
        vdaConsentArtifactId: 'consent-001',
        language: 'en',
      });

      expect(result.safetyStatus).toBe('IDENTITY_ACCESS_RESTRICTED');
      expect(result.selectedAgent).toBe('rbac-identity-guard');
      expect(result.content.summary).toContain("Vijay Chauhan's health records");
      expect(result.content.summary).toContain('Sunita');
      expect(result.content.actions).toEqual([
        { label: 'Switch Profile', action: 'SWITCH_PROFILE' },
      ]);

      expect(mockIntentClassifier.classifyIntent).not.toHaveBeenCalled();
      expect(mockClinicalContextService.buildContext).not.toHaveBeenCalled();
    });

    it('allows normal turn when identity matches authorized profile', async () => {
      const result = await orchestrator.orchestrateTurn({
        sessionId: 'session-001',
        inputText: 'Main Vijay hoon, meri dawai batao',
        correlationId: 'corr-rbac-003',
        identity: mockIdentity,
        vdaConsentArtifactId: 'consent-001',
        language: 'hi',
      });

      expect(result.safetyStatus).not.toBe('IDENTITY_ACCESS_RESTRICTED');
      expect(mockIntentClassifier.classifyIntent).toHaveBeenCalled();
    });

    it('allows normal clinical questions without identity assertion', async () => {
      const result = await orchestrator.orchestrateTurn({
        sessionId: 'session-001',
        inputText: 'मेरी कौन सी दवाई चल रही है?',
        correlationId: 'corr-rbac-004',
        identity: mockIdentity,
        vdaConsentArtifactId: 'consent-001',
        language: 'hi',
      });

      expect(result.safetyStatus).not.toBe('IDENTITY_ACCESS_RESTRICTED');
      expect(mockIntentClassifier.classifyIntent).toHaveBeenCalled();
    });

    it('prioritizes Emergency triage over RBAC check', async () => {
      mockSafetyGate.evaluateSafety.mockResolvedValueOnce({
        status: 'ESCALATION_REQUIRED',
        violations: ['EMERGENCY_SYMPTOM_CHEST_PAIN'],
      });

      const result = await orchestrator.orchestrateTurn({
        sessionId: 'session-001',
        inputText: 'Main Sunita hoon, bohot tez chest pain ho raha hai',
        correlationId: 'corr-rbac-005',
        identity: mockIdentity,
        vdaConsentArtifactId: 'consent-001',
        language: 'hi',
      });

      // Emergency gate takes precedence!
      expect(result.selectedAgent).toBe('safety-gate');
      expect(result.safetyStatus).toBe('ESCALATED_BY_RULE');
    });
  });
});
