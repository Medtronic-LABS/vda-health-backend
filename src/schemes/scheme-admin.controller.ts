import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SchemeInput, SchemeService } from './scheme.service';
@Controller('admin/schemes') @UseGuards(AuthGuard)
export class SchemeAdminController {
  constructor(private readonly schemes: SchemeService) {}
  @Get() list(@Query() query: Record<string, string>, @Req() req: any) { return this.schemes.list(req.user.tenantId, { state: query.state, scope: query.scope, query: query.query }); }
  @Post() upsert(@Body() input: SchemeInput, @Req() req: any) { return this.schemes.upsert(req.user.tenantId, input); }
  @Get(':schemeId/eligibility') eligibility(@Param('schemeId') schemeId: string, @Req() req: any) { return this.schemes.eligibilityAssistance(req.user.tenantId, schemeId); }
}
