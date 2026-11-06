import { AuditService } from '../../audit/audit.service';
import { SemanticContextPlannerService } from '../context/semantic-context-planner.service';
import { IAiProvider } from '../interfaces/ai-provider.interface';
import { ILanguageProvider } from '../interfaces/language-provider.interface';
import { AuthorityCategory, IntentType } from './intent.types';
import { IntentClassifierService } from './intent-classifier.service';

describe('IntentClassifierService facility service normalization', () => {
  const classifyWithoutService = async (
    text: string,
    providerResult: Record<string, unknown> = {
      category: IntentType.FACILITY_QUERY,
      authorityCategory: AuthorityCategory.FACILITY_NAVIGATION,
      confidence: 0.95,
      language: 'hi',
      requirements: { state: 'Haryana', district: 'Faridabad' },
    },
  ) => {
    const aiProvider = {
      classify: jest.fn().mockResolvedValue(providerResult),
    } as unknown as IAiProvider;
    const languageProvider = {
      detectLanguage: jest.fn().mockResolvedValue('hi'),
    } as unknown as ILanguageProvider;
    const auditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const contextPlanner = {
      plan: jest.fn().mockReturnValue({
        categories: [],
        knowledgeRequired: false,
        responseRequirements: [],
      }),
    } as unknown as SemanticContextPlannerService;

    const classifier = new IntentClassifierService(
      aiProvider,
      languageProvider,
      auditService,
      contextPlanner,
    );
    return classifier.classifyIntent(text, 'hi');
  };

  it.each(['ECG कहाँ करवाऊँ?', 'ईसीजी कहाँ करवाऊँ?'])(
    'normalizes %s into the IPHS service lookup key when provider omits service',
    async (text) => {
      const intent = await classifyWithoutService(text);

      expect(intent.intent).toBe(IntentType.FACILITY_QUERY);
      expect(intent.requirements?.service).toBe('ECG');
      expect(intent.requirements?.serviceAliases).toEqual([
        'Electrocardiogram',
        'Electrocardiography',
      ]);
    },
  );

  it.each([
    'Hospital for xray scan',
    'X-ray scan',
    'X ray',
    'एक्स रे कहाँ होगा?',
    'radiography near me',
  ])('normalizes %s into X-ray service lookup', async (text) => {
    const intent = await classifyWithoutService(text);
    expect(intent.requirements?.service).toBe('X-ray');
  });

  // "Xray scan" alone was answered with "I could not determine what you need" in the pilot.
  it.each([
    ['Xray scan', 'X-ray'],
    ['एक्स रे', 'X-ray'],
    ['MRI', 'MRI'],
    ['ईसीजी', 'ECG'],
  ])(
    'treats a bare test name %s as a facility search when the provider is unsure',
    async (text, service) => {
      const intent = await classifyWithoutService(text, {
        category: IntentType.UNKNOWN,
        authorityCategory: AuthorityCategory.UNCERTAIN,
        confidence: 0.4,
        language: 'en',
      });
      expect(intent.intent).toBe(IntentType.FACILITY_QUERY);
      expect(intent.authorityCategory).toBe(
        AuthorityCategory.FACILITY_NAVIGATION,
      );
      expect(intent.confidence).toBeGreaterThanOrEqual(0.65);
      expect(intent.requirements?.service).toBe(service);
    },
  );

  // Live replay: scheme and facility replies followed the question's language.
  it.each([
    ['hi', 'en'],
    ['en', 'hi'],
  ])(
    'keeps the %s profile language when the provider reads the question as %s',
    async (profile, detected) => {
      const aiProvider = {
        classify: jest.fn().mockResolvedValue({
          category: IntentType.FACILITY_QUERY,
          authorityCategory: AuthorityCategory.FACILITY_NAVIGATION,
          confidence: 0.9,
          language: detected,
          requirements: { district: 'Faridabad' },
        }),
      } as unknown as IAiProvider;
      const classifier = new IntentClassifierService(
        aiProvider,
        { detectLanguage: jest.fn() } as unknown as ILanguageProvider,
        { logEvent: jest.fn() } as unknown as AuditService,
        {
          plan: jest
            .fn()
            .mockReturnValue({
              categories: [],
              knowledgeRequired: false,
              responseRequirements: [],
            }),
        } as unknown as SemanticContextPlannerService,
      );
      const intent = await classifier.classifyIntent(
        'Where can I get an ultrasound done?',
        profile,
      );
      expect(intent.language).toBe(profile);
    },
  );

  // "Nearby ABDM hospital" was a dead end because "hospital" was searched as a medical service.
  it.each([
    'ABDM hospital',
    'hospital',
    'Hospitals',
    'अस्पताल',
    'sarkari aspatal',
  ])(
    'does not treat the place word %s as a medical service',
    async (service) => {
      const intent = await classifyWithoutService('Nearby ABDM hospital', {
        category: IntentType.FACILITY_QUERY,
        authorityCategory: AuthorityCategory.FACILITY_NAVIGATION,
        confidence: 0.9,
        language: 'en',
        requirements: { district: 'Faridabad', service },
      });
      expect(intent.requirements?.service).toBeUndefined();
      expect(intent.requirements?.district).toBe('Faridabad');
    },
  );

  it('does not filter hospitals by ABDM, which is not a payment scheme', async () => {
    const intent = await classifyWithoutService('Nearby ABDM hospital', {
      category: IntentType.FACILITY_QUERY,
      authorityCategory: AuthorityCategory.FACILITY_NAVIGATION,
      confidence: 0.9,
      language: 'en',
      requirements: { district: 'Faridabad', scheme: 'ABDM' },
    });
    expect(intent.requirements?.scheme).toBeUndefined();
  });
});
