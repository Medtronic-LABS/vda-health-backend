import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
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
    // Report answers contain extracted health values. Keep the in-flight lock and
    // database idempotency key, but never replay or write a response-body cache.
    const reportTurn = typeof (request['body'] as { report_id?: unknown } | undefined)?.report_id === 'string';
    const requestHash = crypto
      .createHash('sha256')
      .update(requestBody)
      .digest('hex');

    const principal = request['user'] as { tenantId?: string; externalId?: string } | undefined;
    const scopeHash = crypto.createHash('sha256').update(JSON.stringify([
      request['originalUrl'] || request['url'], principal?.tenantId, principal?.externalId, idempotencyKey,
    ])).digest('hex');
    const cacheKey = `idempotency:session:${scopeHash}`;
    const lockKey = `lock:idempotency:${scopeHash}`;
    const ownerToken = crypto.randomUUID();

    // Check if idempotency record exists
    const cachedRecordStr = reportTurn ? null : await this.redisService.get(cacheKey);
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
      if (reportTurn) throw new ConflictException('TURN_IN_PROGRESS');
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

      // The first request still owns the turn. A retry can use this key again.
      throw new ConflictException('TURN_IN_PROGRESS');
    }

    // Lock acquired. Proceed with request execution
    return next.handle().pipe(
      tap({
        next: (val: unknown) => {
          if (reportTurn) {
            void this.redisService.releaseLock(lockKey, ownerToken);
            return;
          }
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
