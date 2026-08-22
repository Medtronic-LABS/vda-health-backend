import { BadRequestException, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { HostIdentity } from '../auth/host-identity.context';
import { ConfigurationService } from '../configuration/configuration.service';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { SessionsService } from '../sessions/sessions.service';

@Controller('dev/demo')
@UseGuards(AuthGuard)
export class DevDemoController {
  constructor(
    private readonly config: ConfigurationService,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(ConsentArtifact) private readonly consents: Repository<ConsentArtifact>,
    private readonly sessions: SessionsService,
  ) {}

  @Post('session')
  async createSession(@Req() req: Record<string, unknown>) {
    if (this.config.nodeEnv !== 'development' || !this.config.devAuthEnabled) {
      throw new BadRequestException('Development demo is disabled.');
    }
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
}
