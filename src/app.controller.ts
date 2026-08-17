import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { RedisService } from './redis/redis.service';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth(@Res() res: Response) {
    let dbStatus = 'healthy';
    let redisStatus = 'healthy';
    let overallStatus = 'ok';

    // Check database status
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      dbStatus = 'unhealthy';
      overallStatus = 'unhealthy'; // Database failure -> unhealthy
    }

    // Check redis status
    try {
      const pong = await this.redisService.ping();
      if (pong !== 'PONG') {
        throw new Error('Redis ping failed');
      }
    } catch {
      redisStatus = 'unhealthy';
      if (overallStatus !== 'unhealthy') {
        overallStatus = 'degraded'; // Redis failure -> degraded or unhealthy
      }
    }

    const payload = {
      status: overallStatus,
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    };

    if (overallStatus === 'unhealthy') {
      return res.status(503).json(payload);
    }

    return res.status(200).json(payload);
  }
}
