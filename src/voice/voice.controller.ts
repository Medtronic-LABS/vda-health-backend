import { BadRequestException, Body, Controller, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { AuditService } from '../audit/audit.service';
import { VoiceTtsDto } from './dto/voice-tts.dto';
import { VoiceService } from './voice.service';
import { LangSmithTracerService, TurnTraceContext } from '../observability/langsmith-tracer.service';
import { STTResponse, VoiceSttProviderName } from '../ai/interfaces/stt-provider.interface';
import { TTSResponse } from '../ai/interfaces/tts-provider.interface';

@Controller('voice')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly audit: AuditService,
    private readonly tracer: LangSmithTracerService,
  ) {}

  @Post('stt')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async stt(
    @UploadedFile() audio: { buffer: Buffer; mimetype: string } | undefined,
    @Body('language_code') languageCode: string | undefined,
    @Body('provider') requestedProviderValue: string | undefined,
    @Body('duration_ms') durationValue: string | undefined,
    @Req() req: Record<string, unknown>,
  ) {
    if (!audio?.buffer?.length || !audio.mimetype.startsWith('audio/')) throw new BadRequestException('A non-empty audio recording is required.');
    const identity = req.user as HostIdentity;
    const correlationId = (req.correlationId as string) || 'voice-stt';
    const requestedProvider = this.requestedProvider(requestedProviderValue);
    const primaryProvider = this.voice.sttPrimaryProvider(requestedProvider);
    const audioDurationMs = this.audioDuration(durationValue);
    const trace = await this.startVoiceTrace(identity, correlationId, languageCode, 'speech_to_text');
    let result: STTResponse | undefined;
    try {
      await this.tracer.traceStep(
        trace,
        {
          name: 'speech_to_text',
          runType: 'tool',
          provider: primaryProvider,
          model: primaryProvider === 'sravaani' ? 'ARTPARK-IISc/SraVaani-0.5-live' : 'saaras:v3',
          inputs: { audio: '[redacted]' },
          metadata: { language: languageCode || 'unspecified', audioDurationMs, primaryProvider },
          necessity: 'NECESSARY',
          necessityReason: 'Transcribes patient-recorded audio before the existing text turn flow.',
        },
        async () => {
          result = await this.voice.transcribe({
            audioBuffer: audio.buffer,
            mimeType: audio.mimetype,
            languageHint: languageCode,
            requestedProvider,
          });
          return {
            provider: result.provider,
            model: result.model,
            primaryProvider: result.primaryProvider,
            fallbackUsed: result.fallbackUsed,
            fallbackReason: result.fallbackReason,
            detectedLanguage: result.detectedLanguage,
            audioDurationMs,
            successCategory: 'SUCCESS',
            transcript: '[redacted]',
          };
        },
      );
      if (!result) throw new Error('Voice transcription returned no result.');
      await this.auditVoice(identity, correlationId, 'voice_stt', languageCode, true, result.provider);
      await this.endVoiceTrace(trace, 'speech_to_text', 'SAFE');
      return result;
    } catch (error) {
      await this.auditVoice(identity, correlationId, 'voice_stt', languageCode, false, primaryProvider);
      await this.endVoiceTrace(trace, 'speech_to_text', 'ERROR');
      throw error;
    }
  }

  @Post('tts')
  async tts(@Body() body: VoiceTtsDto, @Req() req: Record<string, unknown>, @Res() res: Response) {
    const identity = req.user as HostIdentity;
    const correlationId = (req.correlationId as string) || 'voice-tts';
    const trace = await this.startVoiceTrace(identity, correlationId, body.language_code, 'text_to_speech');
    const primaryProvider = this.voice.ttsPrimaryProvider();
    let result: TTSResponse | undefined;
    try {
      await this.tracer.traceStep(
        trace,
        {
          name: 'text_to_speech',
          runType: 'tool',
          provider: primaryProvider,
          model: this.voice.ttsPrimaryModel(),
          inputs: { text: '[redacted]' },
          metadata: { language: body.language_code, primaryProvider },
          necessity: 'NECESSARY',
          necessityReason: 'Creates accessibility playback from the final patient-facing response.',
        },
        async () => {
          result = await this.voice.synthesize({ text: body.text, languageCode: body.language_code });
          return {
            provider: result.provider,
            model: result.model,
            primaryProvider: result.primaryProvider,
            fallbackUsed: result.fallbackUsed,
            fallbackReason: result.fallbackReason,
            language: body.language_code,
            costStatus: 'NOT_APPLICABLE',
            audio: '[redacted]',
            successCategory: 'SUCCESS',
          };
        },
      );
      if (!result) throw new Error('Voice synthesis returned no result.');
      await this.auditVoice(identity, correlationId, 'voice_tts', body.language_code, true, result.provider);
      await this.endVoiceTrace(trace, 'text_to_speech', 'SAFE');
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(result.audioBuffer);
    } catch (error) {
      await this.auditVoice(identity, correlationId, 'voice_tts', body.language_code, false, primaryProvider);
      await this.endVoiceTrace(trace, 'text_to_speech', 'ERROR');
      throw error;
    }
  }

  private requestedProvider(value: string | undefined): VoiceSttProviderName | undefined {
    return value === 'sravaani' || value === 'sarvam' ? value : undefined;
  }

  private audioDuration(value: string | undefined): number | undefined {
    const duration = Number(value);
    return Number.isFinite(duration) && duration >= 0 && duration <= 10 * 60 * 1000
      ? Math.round(duration)
      : undefined;
  }

  private async startVoiceTrace(identity: HostIdentity, correlationId: string, language: string | undefined, operation: string): Promise<TurnTraceContext> {
    return this.tracer.startTurn({
      sessionId: `voice:${correlationId}`,
      correlationId,
      inputText: `[${operation} content redacted]`,
      language,
      tenantId: identity.tenantId,
      externalId: identity.externalId,
    });
  }

  private async endVoiceTrace(trace: TurnTraceContext, operation: string, safetyStatus: string): Promise<void> {
    await this.tracer.endTurn(trace, {
      responseType: operation,
      content: { summary: `[${operation} content redacted]` },
      intent: operation,
      selectedAgent: 'voice-service',
      safetyStatus,
    });
  }

  private async auditVoice(identity: HostIdentity, correlationId: string, action: string, language: string | undefined, success: boolean, provider: string) {
    await this.audit.logEvent({ tenantId: identity.tenantId, subjectAbhaRef: identity.subjectAbhaRef || identity.externalId, actingPrincipal: identity.externalId, correlationId, action, entityName: 'voice_request', details: { language: language || 'unknown', provider, success } });
  }
}
