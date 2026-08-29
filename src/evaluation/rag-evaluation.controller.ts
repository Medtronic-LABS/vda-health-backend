import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RagEvaluationService } from './rag-evaluation.service';

@Controller('admin/evaluation')
@UseGuards(AuthGuard)
export class RagEvaluationController {
  constructor(private readonly evaluation: RagEvaluationService) {}
  @Get('rag-quality') dashboard(@Req() request: any) { return this.evaluation.dashboard(request.user.tenantId); }
  @Get('dashboard-summary') summary(@Req() request: any) { return this.evaluation.adminSummary(request.user.tenantId); }
  @Post('rag-quality/run-controlled') runControlled(@Req() request: any) { return this.evaluation.runControlled(request.user.tenantId); }
}
