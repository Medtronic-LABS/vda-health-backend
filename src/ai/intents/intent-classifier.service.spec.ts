import { AuditService } from '../../audit/audit.service';
import { SemanticContextPlannerService } from '../context/semantic-context-planner.service';
import { IAiProvider } from '../interfaces/ai-provider.interface';
import { ILanguageProvider } from '../interfaces/language-provider.interface';
import { AuthorityCategory, IntentType } from './intent.types';
import { IntentClassifierService } from './intent-classifier.service';

describe('IntentClassifierService facility service normalization', () => {
  const classifyWithoutService = async (text: string) => {
    const aiProvider = {
      classify: jest.fn().mockResolvedValue({
        category: IntentType.FACILITY_QUERY,
        authorityCategory: AuthorityCategory.FACILITY_NAVIGATION,
        confidence: 0.95,
        language: 'hi',
        requirements: { state: 'Haryana', district: 'Faridabad' },
      }),
    } as unknown as IAiProvider;
    const languageProvider = {
      detectLanguage: jest.fn().mockResolvedValue('hi'),
    } as unknown as ILanguageProvider;
    const auditService = { logEvent: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
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
});
