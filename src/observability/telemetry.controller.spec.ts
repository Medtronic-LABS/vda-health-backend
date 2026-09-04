import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryController } from './telemetry.controller';
import { LangSmithTracerService } from './langsmith-tracer.service';

describe('TelemetryController', () => {
  let controller: TelemetryController;
  let mockTracerService: Partial<LangSmithTracerService>;

  beforeEach(async () => {
    mockTracerService = {
      getRecentTraces: jest.fn().mockReturnValue([
        {
          turnId: 'turn-123',
          sessionId: 'sess-1',
          correlationId: 'corr-1',
          timestamp: new Date().toISOString(),
          inputExcerpt: 'Hello',
          intent: 'GREETING',
          totalLatencyMs: 150,
          totalCostUsd: 0.0001,
          totalCalls: 2,
          necessaryCalls: 2,
          unnecessaryCalls: 0,
          preventableRetries: 0,
          efficiencyScorePercent: 100,
          steps: [],
          optimizationRecommendations: [],
        },
      ]),
      getCostSummary: jest.fn().mockReturnValue({
        totalTurns: 1,
        totalCostUsd: 0.0001,
        totalTokens: 500,
        avgLatencyMs: 150,
        unnecessaryCallsRate: 0,
        optimizationTips: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [
        {
          provide: LangSmithTracerService,
          useValue: mockTracerService,
        },
      ],
    }).compile();

    controller = module.get<TelemetryController>(TelemetryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return recent traces from service', () => {
    const traces = controller.getTraces('10');
    expect(traces.length).toBe(1);
    expect(traces[0].turnId).toBe('turn-123');
    expect(mockTracerService.getRecentTraces).toHaveBeenCalledWith(10);
  });

  it('should return cost summary from service', () => {
    const summary = controller.getCostSummary();
    expect(summary.totalTurns).toBe(1);
    expect(summary.totalCostUsd).toBe(0.0001);
    expect(mockTracerService.getCostSummary).toHaveBeenCalled();
  });
});
