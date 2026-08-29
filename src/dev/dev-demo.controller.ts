import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { ConfigurationService } from '../configuration/configuration.service';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { SessionsService } from '../sessions/sessions.service';
import { SyntheticPatientInput, SyntheticPatientService } from './synthetic-patient.service';

@Controller('dev/demo')
@UseGuards(AuthGuard)
export class DevDemoController {
  constructor(
    private readonly config: ConfigurationService,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(ConsentArtifact) private readonly consents: Repository<ConsentArtifact>,
    private readonly sessions: SessionsService,
    private readonly syntheticPatients: SyntheticPatientService,
  ) {}

  private assertEnabled() {
    if (this.config.nodeEnv !== 'development' || !this.config.devAuthEnabled) {
      throw new BadRequestException('Development demo is disabled.');
    }
  }

  @Post('session')
  async createSession(@Req() req: Record<string, unknown>) {
    this.assertEnabled();
    const identity = req['user'] as HostIdentity;
    if (!identity.subjectAbhaRef) {
      throw new BadRequestException('Development subject identity is unavailable.');
    }
    let tenant = await this.tenants.findOne({ where: { id: identity.tenantId } });
    if (!tenant) {
      tenant = this.tenants.create({ id: identity.tenantId, name: 'VDA Development Demo', domain: 'dev.vda.local', status: 'ACTIVE' });
      await this.tenants.save(tenant);
    }
    const consent = this.consents.create({
      tenantId: identity.tenantId,
      subjectId: identity.externalId,
      consentVersion: 'development-demo-v1',
      scopes: ['record_read', 'conversation_retention'],
      language: 'hi', deliveryMode: 'text', retentionInfo: { mode: 'development-demo' }, status: 'ACTIVE',
    });
    const savedConsent = await this.consents.save(consent);
    const session = await this.sessions.createSession({
      external_id: identity.externalId, subject_abha_ref: identity.subjectAbhaRef,
      speaker: 'self', locale_hint: 'hi', consent_artefact_id: savedConsent.id,
    }, identity, (req['correlationId'] as string) || 'dev-demo-session');
    return { session_id: session.id, expires_at: session.absoluteExpiresAt, context_loaded: true, development_demo: true };
  }

  @Get('patients')
  async listPatients(@Req() req: Record<string, unknown>) {
    this.assertEnabled();
    return this.syntheticPatients.list((req['user'] as HostIdentity).tenantId);
  }

  @Post('patients')
  async createPatient(@Body() input: SyntheticPatientInput, @Req() req: Record<string, unknown>) {
    this.assertEnabled();
    if (!input.name || !input.age || !input.gender || !input.state || !input.district) {
      throw new BadRequestException('name, age, gender, state and district are required for a synthetic patient.');
    }
    return this.syntheticPatients.create((req['user'] as HostIdentity).tenantId, input);
  }

  @Get('patients/:id')
  async getPatient(@Param('id') id: string, @Req() req: Record<string, unknown>) {
    this.assertEnabled();
    return this.syntheticPatients.get((req['user'] as HostIdentity).tenantId, id);
  }

  @Patch('patients/:id')
  async updatePatient(@Param('id') id: string, @Body() input: Partial<SyntheticPatientInput>, @Req() req: Record<string, unknown>) {
    this.assertEnabled();
    return this.syntheticPatients.update((req['user'] as HostIdentity).tenantId, id, input);
  }

  @Delete('patients/:id')
  async deletePatient(@Param('id') id: string, @Req() req: Record<string, unknown>) {
    this.assertEnabled();
    await this.syntheticPatients.remove((req['user'] as HostIdentity).tenantId, id);
    return { deleted: true };
  }

  @Post('patients/:id/session')
  async startPatientSession(@Param('id') id: string, @Req() req: Record<string, unknown>) {
    this.assertEnabled();
    const identity = req['user'] as HostIdentity;
    const patient = await this.syntheticPatients.get(identity.tenantId, id);
    let tenant = await this.tenants.findOne({ where: { id: identity.tenantId } });
    if (!tenant) tenant = await this.tenants.save(this.tenants.create({ id: identity.tenantId, name: 'VDA Development Demo', domain: 'dev.vda.local', status: 'ACTIVE' }));
    const consent = await this.consents.save(this.consents.create({ tenantId: identity.tenantId, subjectId: identity.externalId, consentVersion: 'synthetic-development-v1', scopes: ['record_read', 'conversation_retention'], language: patient.language, deliveryMode: 'text', retentionInfo: { mode: 'synthetic-development', syntheticPatientId: patient.syntheticPatientId }, status: 'ACTIVE' }));
    const session = await this.sessions.createSession({ external_id: identity.externalId, subject_abha_ref: `synthetic:${patient.syntheticPatientId}`, speaker: 'self', locale_hint: patient.language, consent_artefact_id: consent.id }, identity, (req['correlationId'] as string) || 'synthetic-demo-session');
    return { session_id: session.id, synthetic_patient_id: patient.id, patient_name: patient.name, locale: patient.language, development_demo: true };
  }

  /**
   * Demo UI context is derived from the synthetic record bound to this session.
   * It intentionally returns no opaque patient or session identifiers beyond the
   * requested session path, and it never reads a global/default patient.
   */
  @Get('sessions/:sessionId/patient-context')
  async patientContext(@Param('sessionId') sessionId: string, @Req() req: Record<string, unknown>) {
    this.assertEnabled();
    const identity = req['user'] as HostIdentity;
    const session = await this.sessions.getSessionById(sessionId);
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
    if (session.tenantId !== identity.tenantId || !session.subjectAbhaRef.startsWith('synthetic:')) {
      throw new ForbiddenException('TENANT_ACCESS_DENIED');
    }
    const patient = await this.syntheticPatients.getByReference(identity.tenantId, session.subjectAbhaRef);
    if (!patient) throw new NotFoundException('SYNTHETIC_PATIENT_NOT_FOUND');
    const profile = patient.clinicalProfile || {};
    const items = (key: string) => Array.isArray(profile[key]) ? profile[key] as Array<Record<string, unknown>> : [];
    return {
      development_demo: true,
      patient: {
        name: patient.name,
        age: patient.age,
        language: patient.language,
        conditions: items('diagnoses').map((item) => item.name).filter((value): value is string => typeof value === 'string'),
        medications: items('medications').map((item) => ({ name: item.name, dosage: item.dosage, frequency: item.frequency })).filter((item) => typeof item.name === 'string'),
        labs: items('labResults').map((item) => ({ name: item.name, value: item.value, unit: item.unit })).filter((item) => typeof item.name === 'string'),
      },
    };
  }

  @Post('feedback')
  async feedback(@Body() input: { syntheticPatientId: string; sessionId: string; responseId?: string; helpful: boolean; reason?: string }, @Req() req: Record<string, unknown>) {
    this.assertEnabled();
    await this.syntheticPatients.recordFeedback((req['user'] as HostIdentity).tenantId, input);
    return { recorded: true };
  }
}
