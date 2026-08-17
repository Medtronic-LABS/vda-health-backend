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

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
    private readonly consentService: ConsentService,
    private readonly auditService: AuditService,
  ) {}

  async createSession(
    dto: CreateSessionDto,
    identity: HostIdentity,
    correlationId: string,
  ): Promise<Session> {
    // 1. Verify subject authorization
    if (dto.subject_abha_ref !== identity.subjectAbhaRef) {
      // Log consent failure
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: dto.subject_abha_ref,
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
    try {
      await this.consentService.validateConsent(
        dto.consent_artefact_id,
        identity.tenantId,
        identity.externalId,
        ['record_read'],
      );
      // Log successful consent check
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: dto.subject_abha_ref,
        speaker: dto.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'consent_validated',
        entityName: 'consent_artifact',
        entityId: dto.consent_artefact_id,
      });
    } catch (err: any) {
      const msg =
        err instanceof Error ? err.message : 'Consent validation failed';
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: dto.subject_abha_ref,
        speaker: dto.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'consent_failure',
        entityName: 'consent_artifact',
        entityId: dto.consent_artefact_id,
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
    session.externalId = dto.external_id;
    session.subjectAbhaRef = dto.subject_abha_ref;
    session.speaker = dto.speaker;
    session.assistContextId = dto.assist_context_id || undefined;
    session.consentArtifactId = dto.consent_artefact_id;
    session.localeHint = dto.locale_hint || undefined;
    session.deviceClass = dto.device_class || undefined;
    session.status = 'ACTIVE';
    session.idleExpiresAt = idleExpiresAt;
    session.absoluteExpiresAt = absoluteExpiresAt;

    const savedSession = await this.sessionRepo.save(session);

    // 7. Audit log session creation
    await this.auditService.logEvent({
      tenantId: identity.tenantId,
      subjectAbhaRef: dto.subject_abha_ref,
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
