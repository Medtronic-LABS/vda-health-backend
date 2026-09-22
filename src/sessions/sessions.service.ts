import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../database/entities/session.entity';
import { ConsentService } from '../consent/consent.service';
import { AuditService } from '../audit/audit.service';
import { HostIdentity } from '../auth/host-identity.context';
import { CreateSessionDto } from './dto/create-session.dto';
import { ConfigurationService } from '../configuration/configuration.service';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
    private readonly consentService: ConsentService,
    private readonly auditService: AuditService,
    private readonly config: ConfigurationService,
  ) {}

  async createSession(
    dto: CreateSessionDto,
    identity: HostIdentity,
    correlationId: string,
  ): Promise<Session> {
    const isMobileUser = identity.authType === 'MOBILE';
    const externalId = isMobileUser ? identity.externalId : dto.external_id;
    const subjectAbhaRef = isMobileUser ? identity.subjectAbhaRef : dto.subject_abha_ref;
    if (!externalId || !subjectAbhaRef) throw new BadRequestException('INVALID_SESSION_SUBJECT');

    // 1. Verify subject authorization
    const isSyntheticDevelopmentSubject =
      this.config.nodeEnv === 'development' &&
      this.config.devAuthEnabled &&
      (subjectAbhaRef.startsWith('synthetic:') || subjectAbhaRef.startsWith('local-file:'));
    if (subjectAbhaRef !== identity.subjectAbhaRef && !isSyntheticDevelopmentSubject) {
      // Log consent failure
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef,
        speaker: dto.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'consent_failure',
        entityName: 'session',
        details: { reason: 'subject_abha_ref mismatch with host context' },
      });
      throw new ForbiddenException('TENANT_ACCESS_DENIED');
    }

    // 2. Verify speaker
    if (dto.speaker !== 'self' && dto.speaker !== 'assisted') {
      throw new BadRequestException('INVALID_SPEAKER');
    }

    // 3. Verify assisted context when speaker = assisted
    if (dto.speaker === 'assisted' && !dto.assist_context_id) {
      throw new BadRequestException('INVALID_ASSIST_CONTEXT');
    }

    // 4. Verify consent artifact is active and has correct scopes
    const mobileConsent = isMobileUser
      ? await this.consentService.ensureMobilePilotConsent(identity.tenantId, identity.externalId, identity.preferredLanguage || dto.locale_hint || 'hi')
      : null;
    const consentArtifactId = mobileConsent?.id || dto.consent_artefact_id;
    if (!consentArtifactId) throw new BadRequestException('CONSENT_MISSING');
    try {
      await this.consentService.validateConsent(consentArtifactId, identity.tenantId, identity.externalId, ['record_read']);
      // Log successful consent check
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef,
        speaker: dto.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'consent_validated',
        entityName: 'consent_artifact',
        entityId: consentArtifactId,
      });
    } catch (err: any) {
      const msg =
        err instanceof Error ? err.message : 'Consent validation failed';
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef,
        speaker: dto.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'consent_failure',
        entityName: 'consent_artifact',
        entityId: consentArtifactId,
        details: { error: msg },
      });
      throw err;
    }

    // 5. Expiration times
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 mins
    const absoluteExpiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours

    // 6. Create session
    const session = new Session();
    session.tenantId = identity.tenantId;
    session.externalId = externalId;
    session.subjectAbhaRef = subjectAbhaRef;
    session.speaker = dto.speaker;
    session.assistContextId = dto.assist_context_id || undefined;
    session.consentArtifactId = consentArtifactId;
    session.localeHint = dto.locale_hint || identity.preferredLanguage || undefined;
    session.deviceClass = dto.device_class || undefined;
    session.status = 'ACTIVE';
    session.idleExpiresAt = idleExpiresAt;
    session.absoluteExpiresAt = absoluteExpiresAt;

    const savedSession = await this.sessionRepo.save(session);

    // 7. Audit log session creation
    await this.auditService.logEvent({
      tenantId: identity.tenantId,
      subjectAbhaRef,
      speaker: dto.speaker,
      actingPrincipal: identity.externalId,
      correlationId,
      action: 'session_created',
      entityName: 'session',
      entityId: savedSession.id,
    });

    return savedSession;
  }

  async closeSession(
    sessionId: string,
    identity: HostIdentity,
    correlationId: string,
  ): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    // Enforce tenant boundary
    if (session.tenantId !== identity.tenantId) {
      throw new ForbiddenException('TENANT_ACCESS_DENIED');
    }

    // Enforce subject boundary
    if (session.externalId !== identity.externalId) {
      throw new ForbiddenException('TENANT_ACCESS_DENIED');
    }

    // Idempotency: if already closed, return
    if (session.status === 'CLOSED') {
      return;
    }

    // Mutate state
    session.status = 'CLOSED';
    session.closedAt = new Date();
    await this.sessionRepo.save(session);

    // Audit log closure
    await this.auditService.logEvent({
      tenantId: identity.tenantId,
      subjectAbhaRef: session.subjectAbhaRef,
      speaker: session.speaker,
      actingPrincipal: identity.externalId,
      correlationId,
      action: 'session_closed',
      entityName: 'session',
      entityId: session.id,
    });
  }

  async getSessionById(sessionId: string): Promise<Session | null> {
    return this.sessionRepo.findOne({ where: { id: sessionId } });
  }
}
