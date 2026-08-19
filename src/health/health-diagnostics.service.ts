import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { ConfigurationService } from '../configuration/configuration.service';

export interface LivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  services: {
    database: 'healthy' | 'unhealthy';
    redis: 'healthy' | 'unhealthy';
    abdm_provider: 'active' | 'development_fixture';
  };
  timestamp: string;
}

@Injectable()
export class HealthDiagnosticsService {
  private readonly logger = new Logger(HealthDiagnosticsService.name);
  private readonly startTime = Date.now();

  private cachedReadiness: ReadinessResponse | null = null;
  private lastCacheTime = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly configService: ConfigurationService,
  ) {}

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const now = Date.now();
    const ttl = this.configService.healthCacheTtlMs;

    if (this.cachedReadiness && now - this.lastCacheTime < ttl) {
      return this.cachedReadiness;
    }

    let dbStatus: 'healthy' | 'unhealthy' = 'healthy';
    let redisStatus: 'healthy' | 'unhealthy' = 'healthy';
    let overallStatus: 'ok' | 'degraded' | 'unhealthy' = 'ok';

    // 1. Check PostgreSQL Database connection
    try {
      await this.dataSource.query('SELECT 1');
    } catch (err: unknown) {
      dbStatus = 'unhealthy';
      overallStatus = 'unhealthy';
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Health readiness DB check failed: ${errMsg}`);
    }

    // 2. Check Redis Cache connection
    try {
      const pingRes = await this.redisService.ping();
      if (pingRes !== 'PONG') {
        throw new Error('Redis ping returned non-PONG result');
      }
    } catch (err: unknown) {
      redisStatus = 'unhealthy';
      if (overallStatus !== 'unhealthy') {
        overallStatus = 'degraded';
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Health readiness Redis check failed: ${errMsg}`);
    }

    const abdmProviderStatus = this.configService.abdmEnabled
      ? 'active'
      : 'development_fixture';

    const result: ReadinessResponse = {
      status: overallStatus,
      services: {
        database: dbStatus,
        redis: redisStatus,
        abdm_provider: abdmProviderStatus,
      },
      timestamp: new Date().toISOString(),
    };

    this.cachedReadiness = result;
    this.lastCacheTime = now;
    return result;
  }
}
