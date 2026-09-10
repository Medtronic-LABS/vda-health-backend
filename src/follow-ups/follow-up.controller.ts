import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { RecordFollowUpAttendanceDto } from './dto/record-follow-up-attendance.dto';
import { FollowUpService } from './follow-up.service';

@Controller('sessions')
@UseGuards(AuthGuard)
export class FollowUpController {
  constructor(private readonly followUps: FollowUpService) {}

  @Get(':sessionId/follow-ups')
  list(@Param('sessionId') sessionId: string, @Req() request: Record<string, unknown>) {
    const identity = request.user as HostIdentity;
    return this.followUps.listForSession(identity.tenantId, sessionId);
  }

  @Post(':sessionId/follow-ups/:followUpId/attendance')
  recordAttendance(
    @Param('sessionId') sessionId: string,
    @Param('followUpId') followUpId: string,
    @Body() dto: RecordFollowUpAttendanceDto,
    @Req() request: Record<string, unknown>,
  ) {
    const identity = request.user as HostIdentity;
    return this.followUps.recordAttendance(identity.tenantId, sessionId, followUpId, dto.attended);
  }
}
