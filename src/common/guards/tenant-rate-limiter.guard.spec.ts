import { TenantRateLimiterGuard } from './tenant-rate-limiter.guard';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigurationService } from '../../configuration/configuration.service';
import { RedisService } from '../../redis/redis.service';

describe('TenantRateLimiterGuard Unit Tests', () => {
  let guard: TenantRateLimiterGuard;
  let mockConfigService: {
    rateLimitEnabled: boolean;
    rateLimitFailOpen: boolean;
    rateLimitTenantMaxRequests: number;
    rateLimitSessionMaxRequests: number;
    rateLimitWindowSeconds: number;
  };
  let mockRedisService: {
    incr: jest.Mock;
    ttl: jest.Mock;
    expire: jest.Mock;
  };

  beforeEach(() => {
    mockConfigService = {
      rateLimitEnabled: true,
      rateLimitFailOpen: true,
      rateLimitTenantMaxRequests: 5,
      rateLimitSessionMaxRequests: 2,
      rateLimitWindowSeconds: 60,
    };
    mockRedisService = {
      incr: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(60),
      expire: jest.fn().mockResolvedValue(1),
    };

    guard = new TenantRateLimiterGuard(
      mockConfigService as unknown as ConfigurationService,
      mockRedisService as unknown as RedisService,
    );
  });

  function createMockContext(
    url: string,
    headers: Record<string, string> = {},
  ) {
    const mockResHeaders: Record<string, string> = {};
    const mockRequest = {
      url,
      originalUrl: url,
      headers,
      ip: '127.0.0.1',
    };
    const mockResponse = {
      setHeader: (key: string, val: string) => {
        mockResHeaders[key] = val;
      },
    };

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    return { ctx, mockResHeaders };
  }

  it('should allow request when rate count is within limit and set rate limit headers', async () => {
    const { ctx, mockResHeaders } = createMockContext(
      '/api/v1/sessions/123/turns',
    );
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(mockResHeaders['X-RateLimit-Limit']).toBe('5');
    expect(mockResHeaders['X-RateLimit-Remaining']).toBe('4');
    expect(mockResHeaders['X-RateLimit-Reset']).toBeDefined();
  });

  it('should throw 429 TOO_MANY_REQUESTS when count exceeds limit', async () => {
    mockRedisService.incr.mockResolvedValue(6);
    const { ctx } = createMockContext('/api/v1/sessions/123/turns');

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('should fail open when Redis fails and rateLimitFailOpen is true', async () => {
    mockRedisService.incr.mockRejectedValue(new Error('Redis Down'));
    const { ctx } = createMockContext('/api/v1/sessions/123/turns');

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should fail closed (503) when Redis fails and rateLimitFailOpen is false', async () => {
    mockConfigService.rateLimitFailOpen = false;
    mockRedisService.incr.mockRejectedValue(new Error('Redis Down'));
    const { ctx } = createMockContext('/api/v1/sessions/123/turns');

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });
});
