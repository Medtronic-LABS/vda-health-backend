import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthDiagnosticsService } from './health-diagnostics.service';

@Controller('health')
export class HealthDiagnosticsController {
  constructor(
    private readonly healthDiagnosticsService: HealthDiagnosticsService,
  ) {}

  @Get('liveness')
  getLiveness(@Res() res: Response) {
    const data = this.healthDiagnosticsService.getLiveness();
    return res.status(200).json(data);
  }

  @Get('readiness')
  async getReadiness(@Res() res: Response) {
    const data = await this.healthDiagnosticsService.getReadiness();
    if (data.status === 'unhealthy') {
      return res.status(503).json(data);
    }
    return res.status(200).json(data);
  }

  @Get()
  async getRootHealth(@Res() res: Response) {
    return this.getReadiness(res);
  }
}
