/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { ConfigurationService } from '../configuration/configuration.service';

jest.mock('ioredis', () => {
  const mockRedis = jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      get: jest.fn().mockResolvedValue('value'),
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    };
  });
  return {
    __esModule: true,
    default: mockRedis,
    Redis: mockRedis,
  };
});

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: any;

  const mockConfigService = {
    redisHost: 'localhost',
    redisPort: 6379,
    redisPassword: 'password',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigurationService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    mockRedisClient = (service as any).redis;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call ping', async () => {
    const result = await service.ping();
    expect(result).toBe('PONG');
    expect(mockRedisClient.ping).toHaveBeenCalled();
  });

  it('should get a key', async () => {
    const result = await service.get('test-key');
    expect(result).toBe('value');
    expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
  });

  it('should acquire a lock with owner token and TTL', async () => {
    const result = await service.acquireLock('lock-key', 'token-abc', 10);
    expect(result).toBe(true);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'lock:lock-key',
      'token-abc',
      'EX',
      10,
      'NX',
    );
  });

  it('should release a lock using Lua script', async () => {
    const result = await service.releaseLock('lock-key', 'token-abc');
    expect(result).toBe(true);
    expect(mockRedisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      'lock:lock-key',
      'token-abc',
    );
  });

  it('should increment rate limits using Lua script', async () => {
    mockRedisClient.eval.mockResolvedValue(2);
    const result = await service.incrementRateLimit('rate-key', 60);
    expect(result).toBe(2);
    expect(mockRedisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("incr", KEYS[1])'),
      1,
      'ratelimit:rate-key',
      '60',
    );
  });
});
