import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { MedicalReportService } from './medical-report.service';

@Controller('sessions/:sessionId/reports')
@UseGuards(AuthGuard)
export class MedicalReportController {
  constructor(private readonly reports: MedicalReportService) {}

  private identity(req: any): HostIdentity { return req.user as HostIdentity; }
  private correlation(req: any): string { return String(req.correlationId || req.headers?.['x-correlation-id'] || 'report-action'); }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Param('sessionId') sessionId: string, @UploadedFile() file: any,
    @Body('report_consent') consent: string, @Body('language') language: string, @Req() req: any) {
    if (consent !== 'true') throw new BadRequestException('REPORT_UPLOAD_CONSENT_REQUIRED');
    return this.reports.upload(sessionId, this.identity(req), file, true, language || 'hi', this.correlation(req));
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.reports.list(sessionId, this.identity(req));
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(@Param('sessionId') sessionId: string, @Param('id') id: string, @Req() req: any) {
    return this.reports.detail(sessionId, id, this.identity(req));
  }

  @Get(':id/source')
  async source(@Param('sessionId') sessionId: string, @Param('id') id: string,
    @Req() req: any, @Res({ passthrough: true }) response: Response) {
    const source = await this.reports.source(sessionId, id, this.identity(req), this.correlation(req));
    response.setHeader('Content-Type', source.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${source.filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(source.buffer);
  }

  @Post(':id/confirm-replacement')
  @Header('Cache-Control', 'private, no-store')
  confirmReplacement(@Param('sessionId') sessionId: string, @Param('id') id: string, @Req() req: any) {
    return this.reports.confirmReplacement(sessionId, id, this.identity(req), this.correlation(req));
  }

  @Delete(':id')
  remove(@Param('sessionId') sessionId: string, @Param('id') id: string, @Req() req: any) {
    return this.reports.remove(sessionId, id, this.identity(req), this.correlation(req));
  }
}
