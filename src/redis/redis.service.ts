import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigurationService } from '../configuration/configuration.service';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigurationService) {
    this.redis = new Redis({
      host: this.configService.redisHost,
      port: this.configService.redisPort,
      password: this.configService.redisPassword || undefined,
      maxRetriesPerRequest: null, // Critical setting for retry strategy
      reconnectOnError: (err) => {
        this.logger.error(`Redis reconnection on error: ${err.message}`);
        return true; // Reconnect
      },
      retryStrategy: (times) => {
        // Linear backoff up to 3000ms
        const delay = Math.min(times * 100, 3000);
        this.logger.warn(`Retrying Redis connection in ${delay}ms...`);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis Error: ${err.message}`);
    });
  }

  async ping(): Promise<string> {
    return this.redis.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Acquires a distributed lock using NX (Not Exists) and EX (Expiration).
   * Ensures mutual exclusion for a specific TTL.
   */
  async acquireLock(
    key: string,
    ownerToken: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const redisClient = this.redis as unknown as {
      set(
        key: string,
        value: string,
        ex: 'EX',
        ttl: number,
        nx: 'NX',
      ): Promise<string | null>;
    };
    const result = await redisClient.set(
      `lock:${key}`,
      ownerToken,
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Releases a distributed lock atomically using a Lua script to ensure
   * that only the owner of the lock can release it.
   */
  async releaseLock(key: string, ownerToken: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(script, 1, `lock:${key}`, ownerToken);
    return result === 1;
  }

  /**
   * Atomically increments a counter and sets TTL on creation to implement rate limits.
   */
  async incrementRateLimit(
    key: string,
    windowSeconds: number,
  ): Promise<number> {
    const script = `
      local current = redis.call("incr", KEYS[1])
      if current == 1 then
        redis.call("expire", KEYS[1], ARGV[1])
      end
      return current
    `;
    const result = await this.redis.eval(
      script,
      1,
      `ratelimit:${key}`,
      windowSeconds.toString(),
    );
    return Number(result);
  }

  async onApplicationShutdown() {
    this.logger.log('Disconnecting from Redis...');
    await this.redis.quit();
  }
}
