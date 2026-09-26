import { Body, Controller, Get, Param, Post, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { PrescriptionService } from './prescription.service';
import { SyntheticPatientService } from '../dev/synthetic-patient.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../database/entities/session.entity';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { HostIdentity } from '../auth/host-identity.context';
import { PrescriptionVerificationStatus } from '../database/entities/prescription.entity';
import { PrescriptionDecisionDto, VerifyPrescriptionDto } from './dto/verify-prescription.dto';
import { WorkerVerificationGuard } from './worker-verification.guard';
@Controller('dev/demo/patients/:patientId/prescriptions') @UseGuards(AuthGuard)
export class PrescriptionController { constructor(private readonly prescriptions: PrescriptionService, private readonly patients: SyntheticPatientService) {} private async ref(req: any, patientId: string) { const patient = await this.patients.get(req.user.tenantId, patientId); return `synthetic:${patient.syntheticPatientId}`; } @Post() @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })) async upload(@Param('patientId') patientId: string, @UploadedFile() file: any, @Req() req: any) { if (!file?.buffer) throw new BadRequestException('INVALID_FILE'); return this.prescriptions.upload(req.user.tenantId, await this.ref(req, patientId), null, { buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype }); } @Get() async list(@Param('patientId') patientId: string, @Req() req: any) { return this.prescriptions.list(req.user.tenantId, await this.ref(req, patientId)); } @Post(':id/approve') approve(@Param('id') id: string, @Req() req: any) { return this.prescriptions.approve(req.user.tenantId, id); } }

@Controller('sessions/:sessionId/prescriptions')
@UseGuards(AuthGuard)
export class PatientPrescriptionController {
  constructor(
    private readonly prescriptions: PrescriptionService,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {}

  private async ref(req: any, sessionId: string) {
    const session = await this.sessions.findOne({ where: { id: sessionId, tenantId: req.user.tenantId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    if (session.externalId !== req.user.externalId) throw new ForbiddenException('TENANT_ACCESS_DENIED');
    if (req.user.authType === 'MOBILE') {
      const authenticatedSubject = `mobile-user:${req.user.mobileUserId}`;
      if (
        !req.user.mobileUserId ||
        req.user.subjectAbhaRef !== authenticatedSubject ||
        session.subjectAbhaRef !== authenticatedSubject
      ) {
        throw new ForbiddenException('TENANT_ACCESS_DENIED');
      }
      return authenticatedSubject;
    }
    if (
      !session.subjectAbhaRef.startsWith('synthetic:') &&
      !session.subjectAbhaRef.startsWith('local-file:') &&
      !session.subjectAbhaRef.startsWith('dev-')
    ) {
      throw new ForbiddenException('PATIENT_PRESCRIPTION_UPLOAD_REQUIRES_DEVELOPMENT_SESSION');
    }
    return session.subjectAbhaRef;
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@Param('sessionId') sessionId: string, @UploadedFile() file: any, @Req() req: any) {
    if (!file?.buffer) throw new BadRequestException('INVALID_FILE');
    return this.prescriptions.upload(req.user.tenantId, await this.ref(req, sessionId), sessionId, {
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    });
  }

  @Get()
  async list(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.prescriptions.listForSession(req.user.tenantId, await this.ref(req, sessionId), sessionId);
  }

  @Get('current')
  async current(@Param('sessionId') sessionId: string, @Req() req: any) {
    return this.prescriptions.currentSessionState(req.user.tenantId, await this.ref(req, sessionId), sessionId);
  }
}

@Controller('admin/prescriptions')
@UseGuards(AuthGuard, WorkerVerificationGuard)
export class PrescriptionVerificationController {
  constructor(private readonly prescriptions: PrescriptionService) {}
  @Get() list(@Query('status') status: PrescriptionVerificationStatus | undefined, @Req() req: any) { return this.prescriptions.worklist(req.user.tenantId, status); }
  @Get(':id/source') async source(@Param('id') id: string, @Req() req: any, @Res({ passthrough: true }) response: Response) { const source = await this.prescriptions.source(req.user.tenantId, id, req.user as HostIdentity, this.correlationId(req)); response.setHeader('Content-Type', source.mimeType); response.setHeader('Content-Disposition', `inline; filename="${this.safeFilename(source.filename)}"`); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); return new StreamableFile(source.buffer); }
  @Get(':id') detail(@Param('id') id: string, @Req() req: any) { return this.prescriptions.workerDetail(req.user.tenantId, id, req.user as HostIdentity, this.correlationId(req)); }
  @Post(':id/verify') verify(@Param('id') id: string, @Body() dto: VerifyPrescriptionDto, @Req() req: any) { return this.prescriptions.verify(req.user.tenantId, id, dto, req.user as HostIdentity, this.correlationId(req)); }
  @Post(':id/reject') reject(@Param('id') id: string, @Body() dto: PrescriptionDecisionDto, @Req() req: any) { return this.prescriptions.reject(req.user.tenantId, id, dto, req.user as HostIdentity, this.correlationId(req), false); }
  @Post(':id/request-clearer-image') requestClearerImage(@Param('id') id: string, @Body() dto: PrescriptionDecisionDto, @Req() req: any) { return this.prescriptions.reject(req.user.tenantId, id, dto, req.user as HostIdentity, this.correlationId(req), true); }
  private correlationId(req: any): string { return String(req.correlationId || req.headers?.['x-correlation-id'] || 'prescription-review'); }
  private safeFilename(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'prescription'; }
}
