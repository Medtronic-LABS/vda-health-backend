import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantRateLimiterGuard } from '../common/guards/tenant-rate-limiter.guard';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { ConfigurationService } from '../configuration/configuration.service';
import { HostIdentity } from '../auth/host-identity.context';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly configService: ConfigurationService,
  ) {}

  @Post()
  @UseGuards(AuthGuard, TenantRateLimiterGuard)
  @UseInterceptors(IdempotencyInterceptor)
  async create(
    @Body() dto: CreateSessionDto,
    @Req() req: Record<string, unknown>,
  ) {
    const identity = req['user'] as HostIdentity;
    const correlationId = (req['correlationId'] as string) || 'unknown';

    const session = await this.sessionsService.createSession(
      dto,
      identity,
      correlationId,
    );

    return {
      session_id: session.id,
      subject_abha_ref: session.subjectAbhaRef,
      speaker: session.speaker,
      context_loaded: true,
      context_completeness: this.configService.contextCompleteness,
      expires_at: session.absoluteExpiresAt.toISOString(),
      capabilities: {
        voice: true,
        text: true,
        streaming: false,
      },
    };
  }

  @Post(':session_id/close')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async close(
    @Param('session_id') sessionId: string,
    @Req() req: Record<string, unknown>,
  ) {
    const identity = req['user'] as HostIdentity;
    const correlationId = (req['correlationId'] as string) || 'unknown';

    await this.sessionsService.closeSession(sessionId, identity, correlationId);
  }
}
