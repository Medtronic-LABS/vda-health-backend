/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { RedisService } from './../src/redis/redis.service';
import { DataSource } from 'typeorm';

// Jest mocks for NestJS TypeORM integration to avoid database connection
jest.mock('@nestjs/typeorm', () => {
  const original = jest.requireActual('@nestjs/typeorm');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DataSource } = require('typeorm');
  class MockTypeOrmModule {
    static forRoot = jest.fn().mockImplementation(() => {
      const mockDS = {
        query: jest.fn().mockResolvedValue([]),
        entityMetadatas: [],
      };
      const token = original.getDataSourceToken
        ? original.getDataSourceToken()
        : 'default_DataSource';
      return {
        global: true,
        module: MockTypeOrmModule,
        providers: [
          {
            provide: DataSource,
            useValue: mockDS,
          },
          {
            provide: token,
            useValue: mockDS,
          },
        ],
        exports: [DataSource, token],
      };
    });
    static forRootAsync = jest.fn().mockImplementation(() => {
      const mockDS = {
        query: jest.fn().mockResolvedValue([]),
        entityMetadatas: [],
      };
      const token = original.getDataSourceToken
        ? original.getDataSourceToken()
        : 'default_DataSource';
      return {
        global: true,
        module: MockTypeOrmModule,
        providers: [
          {
            provide: DataSource,
            useValue: mockDS,
          },
          {
            provide: token,
            useValue: mockDS,
          },
        ],
        exports: [DataSource, token],
      };
    });
    static forFeature = jest.fn().mockImplementation((entities) => {
      const providers = (entities || []).map((entity: any) => ({
        provide: original.getRepositoryToken(entity),
        useValue: {
          find: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation((dto) => dto),
          save: jest.fn().mockImplementation((dto) => Promise.resolve({ id: 'mock-id', ...dto })),
          delete: jest.fn().mockResolvedValue({ affected: 1 }),
          remove: jest.fn().mockResolvedValue({}),
        },
      }));
      return {
        module: class {},
        providers,
        exports: providers,
      };
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...original,
    TypeOrmModule: MockTypeOrmModule,
  };
});

jest.mock('typeorm', () => {
  const original = jest.requireActual('typeorm');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...original,
    DataSource: class {},
  };
});

describe('AppController (e2e)', () => {
  let app: INestApplication;

  const mockRedisService = {
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue({
        query: jest.fn().mockResolvedValue([]),
      })
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
