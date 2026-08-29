import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { ClinicalEscalationAccessGuard } from './clinical-escalation-access.guard';
import { EscalationService } from './escalation.service';

class ReviewClinicalEscalationDto {
  @IsIn(['TRUE_POSITIVE', 'FALSE_POSITIVE', 'ANNOTATED']) outcome!: 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'ANNOTATED';
  @IsString() @IsOptional() note?: string;
}

class ReviewClinicalResponseDto {
  @IsIn(['APPROVED', 'CORRECTED', 'ANNOTATED']) decision!: 'APPROVED' | 'CORRECTED' | 'ANNOTATED';
  @IsString() @IsOptional() note?: string;
  @IsString() @IsOptional() correctedResponse?: string;
}

@Controller('admin/escalations')
@UseGuards(AuthGuard, ClinicalEscalationAccessGuard)
export class EscalationController {
  constructor(private readonly escalationService: EscalationService) {}
  @Get() list(@Req() req: { user: HostIdentity }, @Query('status') status?: string, @Query('tier') tier?: string, @Query('ruleId') ruleId?: string) { return this.escalationService.list(req.user.tenantId, { status, tier, ruleId }); }
  @Get('open-count') openCount(@Req() req: { user: HostIdentity }) { return this.escalationService.openCount(req.user.tenantId); }
  @Get(':id') get(@Req() req: { user: HostIdentity }, @Param('id') id: string) { return this.escalationService.get(req.user.tenantId, id); }
  @Patch(':id/review') review(@Req() req: { user: HostIdentity }, @Param('id') id: string, @Body() body: ReviewClinicalEscalationDto) { return this.escalationService.review(req.user.tenantId, id, req.user, body.outcome, body.note); }
  @Patch(':id/response-review') reviewResponse(@Req() req: { user: HostIdentity }, @Param('id') id: string, @Body() body: ReviewClinicalResponseDto) { return this.escalationService.reviewResponse(req.user.tenantId, id, req.user, body.decision, body.note, body.correctedResponse); }
}
