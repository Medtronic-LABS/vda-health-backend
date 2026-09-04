import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { LangSmithTracerService } from './langsmith-tracer.service';
import { TelemetryController } from './telemetry.controller';
import { ConfigurationModule } from '../configuration/configuration.module';

@Module({
  imports: [ConfigurationModule],
  controllers: [MetricsController, TelemetryController],
  providers: [MetricsService, LangSmithTracerService],
  exports: [MetricsService, LangSmithTracerService],
})
export class ObservabilityModule {}

