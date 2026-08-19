import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { ConfigurationService } from '../../configuration/configuration.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class TenantRateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(TenantRateLimiterGuard.name);

  constructor(
    private readonly configService: ConfigurationService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.configService.rateLimitEnabled) {
      return true;
    }

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Record<string, any>>();
    const res = httpCtx.getResponse<Response>();

    const url: string = String(req.originalUrl || req.url || '');
    const isSessionCreate =
      url.endsWith('/sessions') ||
      (url.includes('/sessions') && !url.includes('/turns'));

    const limit = isSessionCreate
      ? this.configService.rateLimitSessionMaxRequests
      : this.configService.rateLimitTenantMaxRequests;
    const windowSec = this.configService.rateLimitWindowSeconds;
    const rateType = isSessionCreate ? 'session' : 'turn';

    // Derive a privacy-safe hash key from available context (tenant/session/auth/ip)
    // Never store raw ABHA, phone, email, or raw patient identifiers in Redis keys
    const tenantIdStr =
      typeof req.tenantId === 'string' ? req.tenantId : undefined;
    const sessionIdStr =
      typeof req.sessionId === 'string' ? req.sessionId : undefined;
    const headers = (req.headers || {}) as Record<string, string | undefined>;
    const headerTenantStr =
      typeof headers['x-tenant-id'] === 'string'
        ? headers['x-tenant-id']
        : undefined;
    const headerAuthStr =
      typeof headers['authorization'] === 'string'
        ? headers['authorization']
        : undefined;
    const ipStr = typeof req.ip === 'string' ? req.ip : undefined;

    const rawId: string =
      tenantIdStr ||
      sessionIdStr ||
      headerTenantStr ||
      headerAuthStr ||
      ipStr ||
      'anonymous';

    const hashedKey = createHash('sha256')
      .update(`${rateType}:${rawId}`)
      .digest('hex')
      .slice(0, 32);

    const redisKey = `vda:rate:${rateType}:${hashedKey}`;

    try {
      // Atomic Redis increment & TTL management
      const count = await this.redisService.incr(redisKey);

      let ttl = await this.redisService.ttl(redisKey);
      if (ttl < 0) {
        await this.redisService.expire(redisKey, windowSec);
        ttl = windowSec;
      }

      const remaining = Math.max(0, limit - count);
      const resetEpoch = Math.ceil(Date.now() / 1000) + ttl;

      // Set standard rate limit headers
      res.setHeader('X-RateLimit-Limit', limit.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', resetEpoch.toString());

      if (count > limit) {
        this.logger.warn(
          `[RateLimit] Rate limit exceeded type=${rateType} count=${count} limit=${limit}`,
        );
        throw new HttpException(
          {
            code: 'TOO_MANY_REQUESTS',
            message: 'TOO_MANY_REQUESTS',
            error: 'TOO_MANY_REQUESTS',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[RateLimit] Redis execution error: ${errMsg}`);

      if (this.configService.rateLimitFailOpen) {
        this.logger.warn(`[RateLimit] Failing open as configured.`);
        return true;
      }

      throw new HttpException(
        {
          code: 'RATE_LIMITER_UNAVAILABLE',
          message: 'RATE_LIMITER_UNAVAILABLE',
          error: 'RATE_LIMITER_UNAVAILABLE',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
