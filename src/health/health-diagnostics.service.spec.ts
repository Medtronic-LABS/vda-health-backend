import { HealthDiagnosticsService } from './health-diagnostics.service';
import { DataSource } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { ConfigurationService } from '../configuration/configuration.service';

describe('HealthDiagnosticsService Unit Tests', () => {
  let service: HealthDiagnosticsService;
  let mockDataSource: Partial<DataSource>;
  let mockRedisService: Partial<RedisService>;
  let mockConfigService: Partial<ConfigurationService>;

  beforeEach(() => {
    mockDataSource = {
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    mockRedisService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };
    mockConfigService = {
      healthCacheTtlMs: 0,
      abdmEnabled: false,
    };

    service = new HealthDiagnosticsService(
      mockDataSource as DataSource,
      mockRedisService as RedisService,
      mockConfigService as ConfigurationService,
    );
  });

  it('should return valid liveness response', () => {
    const res = service.getLiveness();
    expect(res.status).toBe('ok');
    expect(res.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.timestamp).toBeDefined();
  });

  it('should return status ok when DB and Redis are healthy', async () => {
    const res = await service.getReadiness();
    expect(res.status).toBe('ok');
    expect(res.services.database).toBe('healthy');
    expect(res.services.redis).toBe('healthy');
    expect(res.services.abdm_provider).toBe('development_fixture');
  });

  it('should return degraded when Redis fails but DB passes', async () => {
    (mockRedisService.ping as jest.Mock).mockRejectedValueOnce(
      new Error('Redis Error'),
    );
    const res = await service.getReadiness();
    expect(res.status).toBe('degraded');
    expect(res.services.database).toBe('healthy');
    expect(res.services.redis).toBe('unhealthy');
  });

  it('should return unhealthy when DB fails', async () => {
    (mockDataSource.query as jest.Mock).mockRejectedValueOnce(
      new Error('DB Conn Error'),
    );
    const res = await service.getReadiness();
    expect(res.status).toBe('unhealthy');
    expect(res.services.database).toBe('unhealthy');
  });
});
