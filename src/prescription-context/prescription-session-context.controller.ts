import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { RefreshPrescriptionSessionContextDto } from './dto/refresh-prescription-session-context.dto';
import { PrescriptionSessionContextService } from './prescription-session-context.service';

@Controller('sessions/:session_id/prescription-context')
export class PrescriptionSessionContextController {
  constructor(private readonly context: PrescriptionSessionContextService) {}

  @Post()
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(@Param('session_id') sessionId: string, @Body() dto: RefreshPrescriptionSessionContextDto, @Req() req: Record<string, unknown>): Promise<void> {
    await this.context.refresh(sessionId, req['user'] as HostIdentity, dto);
  }
}
