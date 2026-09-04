import { Test, TestingModule } from '@nestjs/testing';
import { LangSmithTracerService } from './langsmith-tracer.service';
import { ConfigurationService } from '../configuration/configuration.service';

describe('LangSmithTracerService', () => {
  let service: LangSmithTracerService;
  let mockConfigService: Partial<ConfigurationService>;

  beforeEach(async () => {
    mockConfigService = {
      langsmithEnabled: false,
      langsmithApiKey: undefined,
      langsmithProject: 'vda-health-backend-test',
      langsmithEndpoint: 'https://api.smith.langchain.com',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LangSmithTracerService,
        {
          provide: ConfigurationService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<LangSmithTracerService>(LangSmithTracerService);
    service.onModuleInit();
  });

  describe('Initialization & Local Mode Resilience', () => {
    it('should initialize successfully in local telemetry mode when API key is not present', () => {
      expect(service).toBeDefined();
    });

    it('should start a turn trace and return valid context without throwing', async () => {
      const context = await service.startTurn({
        sessionId: 'session-test-01',
        correlationId: 'corr-test-01',
        inputText: 'नमस्ते डॉक्टर साहब',
        language: 'hi',
        tenantId: 'tenant-demo',
      });

      expect(context.id).toMatch(/^turn-\d+-/);
      expect(context.sessionId).toBe('session-test-01');
      expect(context.steps).toEqual([]);
      expect(context.startTime).toBeGreaterThan(0);
    });
  });

  describe('Cost Calculation Matrix', () => {
    it('should calculate accurate costs for Gemini Flash tokens ($0.075/1M input, $0.30/1M output)', () => {
      // 10,000 prompt tokens = 10,000 * 0.000000075 = $0.00075
      // 2,000 completion tokens = 2,000 * 0.0000003 = $0.0006
      // Total = $0.00135
      const cost = service.calculateCost('gemini', 'gemini-3.5-flash', {
        promptTokens: 10000,
        completionTokens: 2000,
        totalTokens: 12000,
      });

      expect(cost).toBeCloseTo(0.00135, 5);
    });

    it('should calculate accurate costs for Gemini Pro tokens ($1.25/1M input, $5.00/1M output)', () => {
      // 10,000 prompt tokens = 10,000 * 0.00000125 = $0.0125
      // 2,000 completion tokens = 2,000 * 0.000005 = $0.01
      // Total = $0.0225
      const cost = service.calculateCost('gemini', 'gemini-1.5-pro', {
        promptTokens: 10000,
        completionTokens: 2000,
        totalTokens: 12000,
      });

      expect(cost).toBeCloseTo(0.0225, 4);
    });

    it('should charge flat $0.001 for Sarvam API invocations', () => {
      const cost = service.calculateCost('sarvam', 'sarvam-translate-v1');
      expect(cost).toBe(0.001);
    });

    it('should charge $0.00 for local Xenova embedding inference', () => {
      const cost = service.calculateCost('xenova', 'all-MiniLM-L6-v2', {
        totalTokens: 500,
      });
      expect(cost).toBe(0);
    });
  });

  describe('Step Tracing & Call Necessity', () => {
    it('should trace a necessary step and record latency and cost', async () => {
      const context = await service.startTurn({
        sessionId: 'session-test-02',
        correlationId: 'corr-test-02',
        inputText: 'मेरी बीपी की दवा क्या है?',
      });

      const result = await service.traceStep(
        context,
        {
          name: 'intent_classification',
          runType: 'llm',
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          necessity: 'NECESSARY',
          necessityReason: 'Identifies patient medication intent',
        },
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return {
            intent: 'MEDICATION_INQUIRY',
            confidence: 0.95,
            usage: {
              promptTokens: 1500,
              completionTokens: 80,
              totalTokens: 1580,
            },
          };
        },
      );

      expect(result.intent).toBe('MEDICATION_INQUIRY');
      expect(context.steps.length).toBe(1);

      const step = context.steps[0];
      expect(step.stepName).toBe('intent_classification');
      expect(step.provider).toBe('gemini');
      expect(step.necessity).toBe('NECESSARY');
      expect(step.latencyMs).toBeGreaterThanOrEqual(10);
      expect(step.costUsd).toBeGreaterThan(0);
      expect(step.isRetry).toBe(false);
    });

    it('should record redundant or bypassed steps correctly', async () => {
      const context = await service.startTurn({
        sessionId: 'session-test-03',
        correlationId: 'corr-test-03',
        inputText: 'Hello doctor',
        language: 'en',
      });

      service.recordStepDirectly(
        context,
        {
          name: 'language_detection',
          runType: 'tool',
          provider: 'sarvam',
          necessity: 'REDUNDANT',
          necessityReason: 'Client header already provided language "en"',
        },
        { latencyMs: 0 },
      );

      expect(context.steps.length).toBe(1);
      expect(context.steps[0].necessity).toBe('REDUNDANT');
      expect(context.steps[0].latencyMs).toBe(0);
    });

    it('should track preventable retries with appropriate necessity tag', async () => {
      const context = await service.startTurn({
        sessionId: 'session-test-04',
        correlationId: 'corr-test-04',
        inputText: 'Where is the nearest hospital?',
      });

      await service.traceStep(
        context,
        {
          name: 'patient_response_retry',
          runType: 'llm',
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          isRetry: true,
          necessity: 'PREVENTABLE_RETRY',
          necessityReason: 'JSON format invalid in initial response',
        },
        async () => ({
          json: { summary: 'Near hospital' },
          usage: { promptTokens: 800, completionTokens: 50 },
        }),
      );

      expect(context.steps.length).toBe(1);
      expect(context.steps[0].isRetry).toBe(true);
      expect(context.steps[0].necessity).toBe('PREVENTABLE_RETRY');
    });
  });

  describe('Turn Summary & Optimization Recommendations', () => {
    it('should compute turn efficiency and generate optimization tips', async () => {
      const context = await service.startTurn({
        sessionId: 'session-opt-01',
        correlationId: 'corr-opt-01',
        inputText: 'Need help with blood pressure',
      });

      // 1. Redundant language detect
      service.recordStepDirectly(
        context,
        {
          name: 'language_detection',
          runType: 'tool',
          provider: 'sarvam',
          necessity: 'REDUNDANT',
        },
        { latencyMs: 120 },
      );

      // 2. Necessary safety gate
      await service.traceStep(
        context,
        {
          name: 'safety_gate_pre_evaluation',
          runType: 'tool',
          provider: 'safety-gate',
          necessity: 'NECESSARY',
        },
        async () => ({ status: 'SAFE' }),
      );

      // 3. Necessary intent classification
      await service.traceStep(
        context,
        {
          name: 'intent_classification',
          runType: 'llm',
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          necessity: 'NECESSARY',
        },
        async () => ({
          intent: 'MEDICATION_INQUIRY',
          usage: { promptTokens: 500, completionTokens: 50 },
        }),
      );

      // 4. Preventable retry
      await service.traceStep(
        context,
        {
          name: 'patient_response_retry',
          runType: 'llm',
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          isRetry: true,
          necessity: 'PREVENTABLE_RETRY',
        },
        async () => ({
          usage: { promptTokens: 600, completionTokens: 70 },
        }),
      );

      const summary = await service.endTurn(context, {
        responseType: 'text',
        content: { summary: 'Advice given' },
        intent: 'MEDICATION_INQUIRY',
        selectedAgent: 'medication-agent',
        safetyStatus: 'SAFE',
      });

      expect(summary.totalCalls).toBe(4);
      expect(summary.necessaryCalls).toBe(2);
      expect(summary.unnecessaryCalls).toBe(1);
      expect(summary.preventableRetries).toBe(1);
      expect(summary.efficiencyScorePercent).toBe(50);
      expect(summary.totalCostUsd).toBeGreaterThan(0);

      // Check optimization advice
      expect(summary.optimizationRecommendations.some((r) => r.includes('redundant Sarvam'))).toBe(true);
      expect(summary.optimizationRecommendations.some((r) => r.includes('schema constraints'))).toBe(true);
    });

    it('should return aggregated cost summary across recent turns', async () => {
      const context = await service.startTurn({
        sessionId: 'session-cost-01',
        correlationId: 'corr-cost-01',
        inputText: 'Test cost summary',
      });
      await service.endTurn(context, {
        responseType: 'text',
        intent: 'TEST',
        selectedAgent: 'test-agent',
        safetyStatus: 'SAFE',
      });

      const summary = service.getCostSummary();
      expect(summary.totalTurns).toBe(1);
      expect(summary.totalCostUsd).toBeGreaterThanOrEqual(0);
      expect(summary.avgLatencyMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(summary.optimizationTips)).toBe(true);
    });
  });
});
