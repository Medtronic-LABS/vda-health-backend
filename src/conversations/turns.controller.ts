import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { HostIdentity } from '../auth/host-identity.context';
import { CreateTurnDto } from './dto/create-turn.dto';
import { TurnResponseDto } from './interfaces/conversation-response.interface';
import { TurnsService } from './turns.service';

@ApiTags('Turns')
@Controller('sessions/:session_id/turns')
export class TurnsController {
  constructor(private readonly turnsService: TurnsService) {}

  @Post()
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Process a new conversation turn for a session' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique idempotency key for this request',
  })
  @ApiHeader({
    name: 'X-Correlation-Id',
    required: false,
    description: 'Correlation trace identifier',
  })
  @ApiParam({
    name: 'session_id',
    description: 'The internal VDA session UUID',
  })
  @ApiResponse({
    status: 201,
    description: 'Turn processed successfully',
    type: TurnResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid session speaker or request',
  })
  @ApiResponse({
    status: 403,
    description: 'Consent missing or unauthorized access',
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key collision' })
  async create(
    @Param('session_id') sessionId: string,
    @Body() dto: CreateTurnDto,
    @Req() req: Record<string, unknown>,
  ): Promise<TurnResponseDto> {
    const identity = req['user'] as HostIdentity;
    const correlationId = (req['correlationId'] as string) || 'unknown';
    const headers = (req['headers'] || {}) as Record<
      string,
      string | undefined
    >;
    const idempotencyKey = headers['idempotency-key'];

    return this.turnsService.executeTurnPipeline(
      sessionId,
      dto,
      idempotencyKey,
      identity,
      correlationId,
    ) as Promise<TurnResponseDto>;
  }
}
