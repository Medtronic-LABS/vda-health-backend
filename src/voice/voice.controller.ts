import { BadRequestException, Body, Controller, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { AuditService } from '../audit/audit.service';
import { VoiceTtsDto } from './dto/voice-tts.dto';
import { VoiceService } from './voice.service';

@Controller('voice')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService, private readonly audit: AuditService) {}

  @Post('stt')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async stt(@UploadedFile() audio: { buffer: Buffer; mimetype: string } | undefined, @Body('language_code') languageCode: string | undefined, @Req() req: Record<string, unknown>) {
    if (!audio?.buffer?.length || !audio.mimetype.startsWith('audio/')) throw new BadRequestException('A non-empty audio recording is required.');
    const identity = req.user as HostIdentity;
    const correlationId = (req.correlationId as string) || 'voice-stt';
    try {
      const result = await this.voice.transcribe({ audioBuffer: audio.buffer, mimeType: audio.mimetype, languageHint: languageCode });
      await this.auditVoice(identity, correlationId, 'voice_stt', languageCode, true);
      return result;
    } catch (error) {
      await this.auditVoice(identity, correlationId, 'voice_stt', languageCode, false);
      throw error;
    }
  }

  @Post('tts')
  async tts(@Body() body: VoiceTtsDto, @Req() req: Record<string, unknown>, @Res() res: Response) {
    const identity = req.user as HostIdentity;
    const correlationId = (req.correlationId as string) || 'voice-tts';
    try {
      const result = await this.voice.synthesize({ text: body.text, languageCode: body.language_code });
      await this.auditVoice(identity, correlationId, 'voice_tts', body.language_code, true);
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(result.audioBuffer);
    } catch (error) {
      await this.auditVoice(identity, correlationId, 'voice_tts', body.language_code, false);
      throw error;
    }
  }

  private async auditVoice(identity: HostIdentity, correlationId: string, action: string, language: string | undefined, success: boolean) {
    await this.audit.logEvent({ tenantId: identity.tenantId, subjectAbhaRef: identity.subjectAbhaRef || identity.externalId, actingPrincipal: identity.externalId, correlationId, action, entityName: 'voice_request', details: { language: language || 'unknown', provider: 'sarvam', success } });
  }
}
