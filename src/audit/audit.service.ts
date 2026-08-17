import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AuditEvent } from '../database/entities/audit-event.entity';
import { ConfigurationService } from '../configuration/configuration.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepo: Repository<AuditEvent>,
    private readonly configService: ConfigurationService,
  ) {}

  hashSubject(subject: string): { hash: string; keyId: string } {
    const keyId = this.configService.auditHmacKeyId || 'v1';
    const secret =
      this.configService.auditHmacSecret || 'dev-hmac-secret-key-123';
    const hash = crypto
      .createHmac('sha256', secret)
      .update(subject)
      .digest('hex');
    return { hash, keyId };
  }

  async logEvent(params: {
    tenantId: string;
    subjectAbhaRef: string;
    speaker?: string | null;
    actingPrincipal: string;
    correlationId: string;
    action: string;
    entityName: string;
    entityId?: string | null;
    details?: Record<string, any> | null;
  }): Promise<AuditEvent> {
    const { hash, keyId } = this.hashSubject(params.subjectAbhaRef);

    const auditEvent = new AuditEvent();
    auditEvent.tenantId = params.tenantId;
    auditEvent.subjectAbhaRefHash = hash;
    auditEvent.speaker = params.speaker || null;
    auditEvent.actingPrincipal = params.actingPrincipal;
    auditEvent.correlationId = params.correlationId;
    auditEvent.action = params.action;
    auditEvent.entityName = params.entityName;
    auditEvent.entityId = params.entityId || null;
    auditEvent.details = params.details || null;
    auditEvent.hmacKeyId = keyId;

    const saved = await this.auditRepo.save(auditEvent);
    this.logger.log(
      `Audit Logged: action=${params.action} correlationId=${params.correlationId} keyId=${keyId}`,
    );
    return saved;
  }
}
