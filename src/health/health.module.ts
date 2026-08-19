import { Module } from '@nestjs/common';
import { HealthDiagnosticsService } from './health-diagnostics.service';
import { HealthDiagnosticsController } from './health-diagnostics.controller';
import { ConfigurationModule } from '../configuration/configuration.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigurationModule, RedisModule],
  controllers: [HealthDiagnosticsController],
  providers: [HealthDiagnosticsService],
  exports: [HealthDiagnosticsService],
})
export class HealthModule {}
