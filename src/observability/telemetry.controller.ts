import { Controller, Get, Query } from '@nestjs/common';
import { LangSmithTracerService } from './langsmith-tracer.service';
import { TurnTraceSummary } from './telemetry.interface';

@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly tracer: LangSmithTracerService) {}

  @Get('traces')
  getTraces(@Query('limit') limit?: string): TurnTraceSummary[] {
    const parsedLimit = limit ? Math.max(1, Math.min(100, parseInt(limit, 10) || 20)) : 20;
    return this.tracer.getRecentTraces(parsedLimit);
  }

  @Get('cost-summary')
  getCostSummary() {
    return this.tracer.getCostSummary();
  }
}
