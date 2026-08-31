import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { ClinicalEscalationAccessGuard } from './clinical-escalation-access.guard';
import { EscalationService } from './escalation.service';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';

class ReviewClinicalEscalationDto {
  @IsIn(['TRUE_POSITIVE', 'FALSE_POSITIVE', 'ANNOTATED']) outcome!: 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'ANNOTATED';
  @IsString() @IsOptional() note?: string;
}

class ReviewClinicalResponseDto {
  @IsIn(['APPROVED', 'CORRECTED', 'ANNOTATED']) decision!: 'APPROVED' | 'CORRECTED' | 'ANNOTATED';
  @IsString() @IsOptional() note?: string;
  @IsString() @IsOptional() correctedResponse?: string;
}

class SendClinicianMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) message!: string;
}

@Controller('admin/escalations')
@UseGuards(AuthGuard, ClinicalEscalationAccessGuard)
export class EscalationController {
  constructor(private readonly escalationService: EscalationService) {}
  @Get() list(@Req() req: { user: HostIdentity }, @Query('status') status?: string, @Query('tier') tier?: string, @Query('ruleId') ruleId?: string) { return this.escalationService.list(req.user.tenantId, { status, tier, ruleId }); }
  @Get('open-count') openCount(@Req() req: { user: HostIdentity }) { return this.escalationService.openCount(req.user.tenantId); }
  @Get(':id') get(@Req() req: { user: HostIdentity }, @Param('id') id: string) { return this.escalationService.get(req.user.tenantId, id); }
  @Post(':id/messages') @UseInterceptors(IdempotencyInterceptor)
  sendClinicianMessage(@Req() req: { user: HostIdentity; correlationId?: string }, @Param('id') id: string, @Body() body: SendClinicianMessageDto, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.escalationService.sendClinicianMessage(req.user.tenantId, id, req.user.externalId, body.message, req.correlationId || 'clinical-review-message', idempotencyKey);
  }
  @Post(':id/end-clinical-chat') @UseInterceptors(IdempotencyInterceptor)
  endClinicalChat(@Req() req: { user: HostIdentity }, @Param('id') id: string) {
    return this.escalationService.endClinicalConversation(req.user.tenantId, id, req.user.externalId);
  }
  @Patch(':id/review') review(@Req() req: { user: HostIdentity }, @Param('id') id: string, @Body() body: ReviewClinicalEscalationDto) { return this.escalationService.review(req.user.tenantId, id, req.user, body.outcome, body.note); }
  @Patch(':id/response-review') reviewResponse(@Req() req: { user: HostIdentity }, @Param('id') id: string, @Body() body: ReviewClinicalResponseDto) { return this.escalationService.reviewResponse(req.user.tenantId, id, req.user, body.decision, body.note, body.correctedResponse); }
}

@Controller('sessions/:sessionId/clinical-review')
@UseGuards(AuthGuard)
export class PatientClinicalReviewController {
  constructor(private readonly escalationService: EscalationService) {}

  @Get()
  state(@Req() req: { user: HostIdentity }, @Param('sessionId') sessionId: string) {
    return this.escalationService.patientFallbackState(req.user.tenantId, sessionId);
  }

  @Post('teleconsultation')
  requestTeleconsultation(@Req() req: { user: HostIdentity }, @Param('sessionId') sessionId: string) {
    return this.escalationService.requestTeleconsultation(req.user.tenantId, sessionId);
  }
}
