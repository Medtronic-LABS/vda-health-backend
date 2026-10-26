import { lastValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

describe('report turn idempotency privacy', () => {
  const setup = (body: Record<string, unknown>) => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined),
      acquireLock: jest.fn().mockResolvedValue(true), releaseLock: jest.fn().mockResolvedValue(undefined) };
    const response = { statusCode: 201, setHeader: jest.fn(), status: jest.fn() };
    const request = { method: 'POST', originalUrl: '/api/v1/sessions/session/turns',
      headers: { 'idempotency-key': 'key-a' }, user: { tenantId: 'tenant-a', externalId: 'patient-a' }, body };
    const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) };
    return { interceptor: new IdempotencyInterceptor(redis as any, { idempotencyWaitTimeoutMs: 100 } as any),
      context, redis };
  };

  it('does not read or write full report responses in Redis', async () => {
    const { interceptor, context, redis } = setup({ input_text: 'Explain report', report_id: 'report-a' });
    const response = await lastValueFrom(await interceptor.intercept(context as any,
      { handle: () => of({ content: { summary: 'Glucose 110 mg/dL' } }) } as any));
    expect(response.content.summary).toContain('Glucose');
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('preserves normal idempotency caching for unrelated turns', async () => {
    const { interceptor, context, redis } = setup({ input_text: 'Hello' });
    await lastValueFrom(await interceptor.intercept(context as any,
      { handle: () => of({ content: { summary: 'Hello' } }) } as any));
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });
});
