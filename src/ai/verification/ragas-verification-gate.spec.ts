import { Test, TestingModule } from '@nestjs/testing';
import { RagasVerificationGateService } from './ragas-verification-gate.service';
import { ConfigurationService } from '../../configuration/configuration.service';
import { IAiProvider } from '../interfaces/ai-provider.interface';

describe('RagasVerificationGateService', () => {
  let service: RagasVerificationGateService;
  let mockAiProvider: jest.Mocked<IAiProvider>;
  let mockConfig: Partial<ConfigurationService>;

  beforeEach(async () => {
    mockAiProvider = {
      generate: jest.fn(),
      classify: jest.fn(),
      health: jest.fn(),
    } as unknown as jest.Mocked<IAiProvider>;

    mockConfig = {
      ragasThresholdFaithfulness: 0.90,
      ragasThresholdAnswerRelevancy: 0.85,
      ragasThresholdContextPrecision: 0.80,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagasVerificationGateService,
        { provide: 'IAiProvider', useValue: mockAiProvider },
        { provide: ConfigurationService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<RagasVerificationGateService>(RagasVerificationGateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should pass when LLM judge returns scores above thresholds with no clinical violation', async () => {
    mockAiProvider.generate.mockResolvedValueOnce({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      text: '{"faithfulnessScore": 0.95, "answerRelevancyScore": 0.92, "contextPrecisionScore": 0.88, "clinicalViolationDetected": false, "unsupportedClaims": [], "reason": "Fully grounded and relevant"}',
      json: {
        faithfulnessScore: 0.95,
        answerRelevancyScore: 0.92,
        contextPrecisionScore: 0.88,
        clinicalViolationDetected: false,
        unsupportedClaims: [],
        reason: 'Fully grounded and relevant',
      },
    });

    const result = await service.evaluateTurn(
      'What are the symptoms of Type 2 diabetes?',
      'Type 2 diabetes symptoms include increased thirst, frequent urination, and fatigue according to ICMR guidelines.',
      ['ICMR Guidelines: Type 2 diabetes symptoms include increased thirst, frequent urination, increased hunger, and fatigue.'],
    );

    expect(result.passed).toBe(true);
    expect(result.faithfulnessScore).toBe(0.95);
    expect(result.answerRelevancyScore).toBe(0.92);
    expect(result.clinicalViolationDetected).toBe(false);
  });

  it('should fail and trigger breach when faithfulness is below 0.90', async () => {
    mockAiProvider.generate.mockResolvedValueOnce({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      text: '{"faithfulnessScore": 0.70, "answerRelevancyScore": 0.90, "contextPrecisionScore": 0.85, "clinicalViolationDetected": false, "unsupportedClaims": ["Claim about cure with herbal tea"], "reason": "Ungrounded claim"}',
      json: {
        faithfulnessScore: 0.70,
        answerRelevancyScore: 0.90,
        contextPrecisionScore: 0.85,
        clinicalViolationDetected: false,
        unsupportedClaims: ['Claim about cure with herbal tea'],
        reason: 'Ungrounded claim',
      },
    });

    const result = await service.evaluateTurn(
      'How to manage diabetes?',
      'You can cure diabetes completely in 3 days using herbal tea.',
      ['Diabetes is a chronic condition managed with diet, exercise, and prescribed medication.'],
    );

    expect(result.passed).toBe(false);
    expect(result.faithfulnessScore).toBe(0.70);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it('should fail and trigger breach when a clinical scope violation is detected', async () => {
    mockAiProvider.generate.mockResolvedValueOnce({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      text: '{"faithfulnessScore": 0.95, "answerRelevancyScore": 0.95, "contextPrecisionScore": 0.90, "clinicalViolationDetected": true, "unsupportedClaims": [], "reason": "Attempted to diagnose disease"}',
      json: {
        faithfulnessScore: 0.95,
        answerRelevancyScore: 0.95,
        contextPrecisionScore: 0.90,
        clinicalViolationDetected: true,
        unsupportedClaims: [],
        reason: 'Attempted to diagnose disease',
      },
    });

    const result = await service.evaluateTurn(
      'My blood sugar is 250, what do I have?',
      'I diagnose you with severe diabetes. Take 500mg Metformin twice daily.',
      ['Normal blood glucose is below 140 mg/dL.'],
    );

    expect(result.passed).toBe(false);
    expect(result.clinicalViolationDetected).toBe(true);
  });

  it('should fail fast on empty response', async () => {
    const result = await service.evaluateTurn('test query', '', []);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('EMPTY_RESPONSE');
  });

  it('should use deterministic fallback if AI Provider throws error', async () => {
    mockAiProvider.generate.mockRejectedValueOnce(new Error('API quota exceeded'));

    const result = await service.evaluateTurn(
      'HbA1c meaning',
      'HbA1c measures average blood sugar levels over the past 3 months.',
      ['HbA1c test reflects average blood glucose over the past two to three months.'],
    );

    expect(result).toBeDefined();
    expect(result.faithfulnessScore).toBeGreaterThanOrEqual(0.8);
  });
});
