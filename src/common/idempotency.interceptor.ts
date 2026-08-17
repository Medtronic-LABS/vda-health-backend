import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';
import { ConfigurationService } from '../configuration/configuration.service';
import * as crypto from 'crypto';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigurationService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const response = context
      .switchToHttp()
      .getResponse<Record<string, unknown>>();

    // Only apply to POST requests
    if (request['method'] !== 'POST') {
      return next.handle();
    }

    const headers = (request['headers'] || {}) as Record<
      string,
      string | undefined
    >;
    const idempotencyKey = headers['idempotency-key'];
    if (!idempotencyKey) {
      throw new BadRequestException('INVALID_REQUEST');
    }

    const requestBody = JSON.stringify(request['body'] || {});
    const requestHash = crypto
      .createHash('sha256')
      .update(requestBody)
      .digest('hex');

    const cacheKey = `idempotency:session:${idempotencyKey}`;
    const lockKey = `lock:idempotency:${idempotencyKey}`;
    const ownerToken = crypto.randomUUID();

    // Check if idempotency record exists
    const cachedRecordStr = await this.redisService.get(cacheKey);
    if (cachedRecordStr) {
      const cached = JSON.parse(cachedRecordStr) as {
        requestHash: string;
        responseStatus: number;
        responseBody: any;
      };
      if (cached.requestHash !== requestHash) {
        throw new ConflictException('IDEMPOTENCY_CONFLICT');
      }
      if (typeof response['setHeader'] === 'function') {
        (response['setHeader'] as (k: string, v: string) => void)(
          'X-Idempotent-Replay',
          'true',
        );
      }
      if (typeof response['status'] === 'function') {
        (response['status'] as (s: number) => void)(cached.responseStatus);
      }
      return of(cached.responseBody);
    }

    // Attempt to acquire lock for in-flight request
    const acquired = await this.redisService.acquireLock(
      lockKey,
      ownerToken,
      10,
    ); // 10s safety lock
    if (!acquired) {
      // Simultaneous request is in flight. Loop and wait.
      const waitTimeout = this.configService.idempotencyWaitTimeoutMs;
      const interval = 100; // 100ms
      let elapsed = 0;

      while (elapsed < waitTimeout) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        elapsed += interval;

        // Check if finished
        const completedRecordStr = await this.redisService.get(cacheKey);
        if (completedRecordStr) {
          const cached = JSON.parse(completedRecordStr) as {
            requestHash: string;
            responseStatus: number;
            responseBody: any;
          };
          if (cached.requestHash !== requestHash) {
            throw new ConflictException('IDEMPOTENCY_CONFLICT');
          }
          if (typeof response['setHeader'] === 'function') {
            (response['setHeader'] as (k: string, v: string) => void)(
              'X-Idempotent-Replay',
              'true',
            );
          }
          if (typeof response['status'] === 'function') {
            (response['status'] as (s: number) => void)(cached.responseStatus);
          }
          return of(cached.responseBody);
        }
      }

      // If wait expires, return UPSTREAM_TIMEOUT
      throw new GatewayTimeoutException('UPSTREAM_TIMEOUT');
    }

    // Lock acquired. Proceed with request execution
    return next.handle().pipe(
      tap({
        next: (val: unknown) => {
          const status = (response['statusCode'] as number) || 201;
          const ttl = parseInt(
            process.env.IDEMPOTENCY_TTL_SECONDS || '86400',
            10,
          );
          void this.redisService
            .set(
              cacheKey,
              JSON.stringify({
                requestHash,
                responseStatus: status,
                responseBody: val,
              }),
              ttl,
            )
            .then(() => {
              return this.redisService.releaseLock(lockKey, ownerToken);
            });
        },
        error: () => {
          void this.redisService.releaseLock(lockKey, ownerToken);
        },
      }),
    );
  }
}
