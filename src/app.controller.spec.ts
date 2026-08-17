/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';
import { RedisService } from './redis/redis.service';
import { Response } from 'express';

describe('AppController Health Check', () => {
  let controller: AppController;
  let mockDataSource: any;
  let mockRedisService: any;
  let mockResponse: any;

  beforeEach(async () => {
    mockDataSource = {
      query: jest.fn().mockResolvedValue([{ 1: 1 }]),
    };

    mockRedisService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('should return health ok (200) when DB and Redis are healthy', async () => {
    await controller.getHealth(mockResponse as Response);
    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        services: { database: 'healthy', redis: 'healthy' },
      }),
    );
  });

  it('should return health degraded (200) when Redis is unhealthy', async () => {
    mockRedisService.ping.mockRejectedValue(new Error('Redis Down'));
    await controller.getHealth(mockResponse as Response);
    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'degraded',
        services: { database: 'healthy', redis: 'unhealthy' },
      }),
    );
  });

  it('should return health unhealthy (503) when Database is unhealthy', async () => {
    mockDataSource.query.mockRejectedValue(new Error('DB Down'));
    await controller.getHealth(mockResponse as Response);
    expect(mockResponse.status).toHaveBeenCalledWith(503);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unhealthy',
        services: { database: 'unhealthy', redis: 'healthy' },
      }),
    );
  });
});
