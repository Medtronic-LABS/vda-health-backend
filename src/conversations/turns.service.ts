import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { Session } from '../database/entities/session.entity';
import { ConsentArtifact } from '../database/entities/consent-artifact.entity';
import { AuditService } from '../audit/audit.service';
import { HostIdentity } from '../auth/host-identity.context';
import { CreateTurnDto } from './dto/create-turn.dto';
import { IPiiProtectionService } from '../pii/interfaces/pii-protection-service.interface';
import { ISafetyGate } from '../safety/interfaces/safety-gate.interface';
import { IConversationProcessor } from './interfaces/conversation-processor.interface';
import { ConversationResponseFormatter } from './formatters/conversation-response.formatter';
import { MetricsService } from '../observability/metrics.service';
import { EscalationService } from '../escalation/escalation.service';

@Injectable()
export class TurnsService {
  private readonly logger = new Logger(TurnsService.name);

  constructor(
    private readonly auditService: AuditService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject('IPiiProtectionService')
    private readonly piiService: IPiiProtectionService,
    @Inject('ISafetyGate')
    private readonly safetyGate: ISafetyGate,
    @Inject('IConversationProcessor')
    private readonly processor: IConversationProcessor,
    @Optional()
    private readonly responseFormatter?: ConversationResponseFormatter,
    @Optional()
    private readonly metricsService?: MetricsService,
    @Optional()
    private readonly escalationService?: EscalationService,
  ) {}

  /** Audit observability must not suppress a deterministic emergency response. */
  private async recordEmergencyAudit(
    action: string,
    correlationId: string,
    record: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await record();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Emergency audit failed action=${action} correlationId=${correlationId} reason=${reason}`);
    }
  }

  async registerTurn(
    sessionId: string,
    dto: CreateTurnDto,
    idempotencyKey: string | undefined,
    identity: HostIdentity,
    correlationId: string,
    sanitizedInputText?: string,
    safetyStatus = 'SAFE',
  ): Promise<ConversationTurn> {
    return this.dataSource.transaction(async (manager) => {
      if (dto.input_text === 'trigger-tx1-failure') {
        throw new Error('Simulated Database Crash in Transaction 1');
      }
      // 1. Lock the session
      const session = await manager.findOne(Session, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!session) {
        throw new NotFoundException('SESSION_NOT_FOUND');
      }

      // 2. Validate tenant & subject
      if (session.tenantId !== identity.tenantId) {
        throw new ForbiddenException('TENANT_ACCESS_DENIED');
      }
      if (session.externalId !== identity.externalId) {
        throw new ForbiddenException('TENANT_ACCESS_DENIED');
      }

      // 3. Validate status
      if (session.status === 'CLOSED') {
        throw new ForbiddenException('SESSION_CLOSED');
      }

      // 4. Validate expiration
      const now = new Date();
      if (now > session.idleExpiresAt || now > session.absoluteExpiresAt) {
        session.status = 'CLOSED';
        session.closedAt = now;
        await manager.save(session);
        throw new ForbiddenException('SESSION_EXPIRED');
      }

      // 5. Validate speaker & subject attribution consistency
      if (dto.speaker && dto.speaker !== session.speaker) {
        throw new BadRequestException('INVALID_SPEAKER');
      }
      if (dto.subject_ref && dto.subject_ref !== session.subjectAbhaRef) {
        throw new ForbiddenException('TENANT_ACCESS_DENIED');
      }

      // 6. Validate consent inside Transaction 1
      const consent = await manager.findOne(ConsentArtifact, {
        where: { id: session.consentArtifactId },
      });

      if (!consent) {
        throw new ForbiddenException('CONSENT_MISSING');
      }
      if (consent.tenantId !== session.tenantId) {
        throw new ForbiddenException('CONSENT_MISSING');
      }
      if (consent.subjectId !== identity.externalId) {
        throw new ForbiddenException('CONSENT_MISSING');
      }
      if (consent.status !== 'ACTIVE') {
        throw new ForbiddenException('CONSENT_MISSING');
      }
      if (!consent.scopes.includes('record_read')) {
        throw new ForbiddenException('CONSENT_MISSING');
      }

      // 7. Check idempotency retry
      if (idempotencyKey) {
        const existingTurn = await manager.findOne(ConversationTurn, {
          where: { sessionId, idempotencyKey },
        });
        if (existingTurn) {
          // If already completed or processing, return it.
          // The caller will handle checking status.
          return existingTurn;
        }
      }

      // 8. Capture conversation retention decision
      const conversationRetentionGranted = consent.scopes.includes(
        'conversation_retention',
      );

      // 9. Allocate next turn number
      const lastTurn = await manager.findOne(ConversationTurn, {
        where: { sessionId },
        order: { turnNumber: 'DESC' },
      });
      const nextTurnNumber = lastTurn ? lastTurn.turnNumber + 1 : 1;

      // 10. Update idle expiry capped at absolute
      const targetIdle = new Date(now.getTime() + 30 * 60 * 1000); // 30 mins
      session.idleExpiresAt =
        targetIdle > session.absoluteExpiresAt
          ? session.absoluteExpiresAt
          : targetIdle;
      await manager.save(session);

      // 11. Create turn in PROCESSING status
      const turn = new ConversationTurn();
      turn.sessionId = sessionId;
      turn.turnNumber = nextTurnNumber;
      turn.correlationId = correlationId;
      turn.speaker = session.speaker;
      turn.subjectRef = session.subjectAbhaRef;
      const inputToStore =
        sanitizedInputText !== undefined ? sanitizedInputText : dto.input_text;
      turn.inputText = conversationRetentionGranted ? inputToStore : null;
      turn.outputText = null;
      turn.responseType = 'text';
      turn.latency = 0;
      turn.safetyStatus = safetyStatus;
      turn.status = 'PROCESSING';
      turn.idempotencyKey = idempotencyKey || null;
      turn.conversationRetentionGranted = conversationRetentionGranted;
      turn.processingStartedAt = now;

      const savedTurn = await manager.save(turn);

      // 12. Audit turn_received
      await this.auditService.logEvent({
        tenantId: session.tenantId,
        subjectAbhaRef: session.subjectAbhaRef,
        speaker: session.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'turn_received',
        entityName: 'session',
        entityId: session.id,
        details: { turn_number: nextTurnNumber },
      });

      return savedTurn;
    });
  }

  async resolveTurn(
    turnId: string,
    result: {
      responseType: string;
      content: Record<string, any>;
      intent: string | null;
      selectedAgent: string | null;
      safetyStatus: string;
    },
    correlationId: string,
    identity: HostIdentity,
    status = 'COMPLETED',
  ): Promise<ConversationTurn> {
    return this.dataSource.transaction(async (manager) => {
      const turn = await manager.findOne(ConversationTurn, {
        where: { id: turnId },
      });
      if (!turn) {
        throw new NotFoundException('TURN_NOT_FOUND');
      }

      const now = new Date();
      const latency = turn.processingStartedAt
        ? now.getTime() - turn.processingStartedAt.getTime()
        : 0;

      turn.status = status;
      turn.responseType = result.responseType;
      // Enforce captured retention decision
      turn.outputText = turn.conversationRetentionGranted
        ? JSON.stringify(result.content)
        : null;
      turn.intent = result.intent || undefined;
      turn.selectedAgent = result.selectedAgent || undefined;
      turn.latency = latency;
      turn.safetyStatus = result.safetyStatus;

      const saved = await manager.save(turn);

      // Audit turn_processed
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: turn.subjectRef,
        speaker: turn.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'turn_processed',
        entityName: 'conversation_turn',
        entityId: turn.id,
        details: { turn_number: turn.turnNumber, latency },
      });

      return saved;
    });
  }

  async failTurn(
    turnId: string,
    error: Error,
    correlationId: string,
    identity: HostIdentity,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const turn = await manager.findOne(ConversationTurn, {
        where: { id: turnId },
      });
      if (!turn) return;

      turn.status = 'REJECTED';
      turn.intent = 'processing-failure';
      turn.selectedAgent = error.message
        ? error.message.substring(0, 100)
        : 'unknown-error';

      await manager.save(turn);

      // Audit turn_rejected
      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: turn.subjectRef,
        speaker: turn.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'turn_rejected',
        entityName: 'conversation_turn',
        entityId: turn.id,
        details: { reason: error.message || 'Processing failed' },
      });
    });
  }

  async executeTurnPipeline(
    sessionId: string,
    dto: CreateTurnDto,
    idempotencyKey: string | undefined,
    identity: HostIdentity,
    correlationId: string,
  ): Promise<any> {
    // Safety receives raw input first; raw text is never persisted or logged here.
    const safetyResult = await this.safetyGate.evaluateSafety(
      dto.input_text,
      correlationId,
      dto.language,
    );

    // 3. If Safety Gate returns INVALID_INPUT, throw validation error immediately
    // BEFORE creating a ConversationTurn (Transaction 1 is NOT called).
    if (safetyResult.status === 'INVALID_INPUT') {
      throw new BadRequestException(
        safetyResult.patientSafeMessage || 'INVALID_INPUT',
      );
    }

    // PII redaction applies to every persisted and downstream representation.
    const piiResult = await this.piiService.sanitizeText(dto.input_text);

    // Determine initial safety status code
    let safetyStatus = 'SAFE';
    if (safetyResult.status === 'ESCALATION_REQUIRED') {
      safetyStatus = 'ESCALATED_BY_RULE';
    } else if (safetyResult.status === 'WITHHOLD') {
      safetyStatus = 'WITHHELD_QUALITY';
    }

    // 4. Register turn inside Transaction 1
    const turn = await this.registerTurn(
      sessionId,
      dto,
      idempotencyKey,
      identity,
      correlationId,
      piiResult.sanitizedText,
      safetyStatus,
    );

    const session = await this.dataSource.getRepository(Session).findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    // 5. If it was already completed (idempotency DB hit), parse and return it immediately
    if (turn.status === 'COMPLETED' || turn.status === 'WITHHELD') {
      let contentObj = {};
      try {
        contentObj = turn.outputText
          ? (JSON.parse(turn.outputText) as Record<string, any>)
          : {};
      } catch {
        contentObj = { text: turn.outputText };
      }
      return {
        turn_number: turn.turnNumber,
        session_id: turn.sessionId,
        response_type: turn.responseType,
        content: contentObj,
        correlation_id: turn.correlationId,
        safety_status: turn.safetyStatus,
        intent: turn.intent || null,
        selected_agent: turn.selectedAgent || null,
        latency: turn.latency,
        created_at: turn.createdAt.toISOString(),
      };
    }

    // 6. Run PII and Safety audits outside of the transactions
    if (piiResult.piiDetected) {
      const piiAudit = () => this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: turn.subjectRef,
        speaker: turn.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'pii_detected',
        entityName: 'conversation_turn',
        entityId: turn.id,
        details: {
          pii_categories: piiResult.detectedPiiCategories,
          pii_detected_count: piiResult.detectedPiiCategories.length,
          status: piiResult.status,
          rule_version: '1.0',
        },
      });
      if (safetyResult.status === 'ESCALATION_REQUIRED') {
        await this.recordEmergencyAudit('pii_detected', correlationId, piiAudit);
      } else {
        await piiAudit();
      }
    }

    const safetyAudit = () => this.auditService.logEvent({
      tenantId: identity.tenantId,
      subjectAbhaRef: turn.subjectRef,
      speaker: turn.speaker,
      actingPrincipal: identity.externalId,
      correlationId,
      action: 'safety_evaluated',
      entityName: 'conversation_turn',
      entityId: turn.id,
      details: {
        status: safetyResult.status,
        rule_id: safetyResult.ruleId,
        rule_version: safetyResult.ruleVersion,
        severity: safetyResult.severity,
        action: safetyResult.action,
      },
    });
    if (safetyResult.status === 'ESCALATION_REQUIRED') {
      await this.recordEmergencyAudit('safety_evaluated', correlationId, safetyAudit);
    } else {
      await safetyAudit();
    }

    // 7. Route based on safety decision
    let responseType: string;
    let content: Record<string, any>;
    let intent: string | null = null;
    let selectedAgent: string | null = null;
    let finalStatus = 'COMPLETED';

    if (safetyResult.status === 'SAFE') {
      const routedToClinicalReview = this.escalationService
        ? await this.escalationService.recordPatientMessage(identity.tenantId, sessionId, turn, identity.externalId)
        : false;
      if (routedToClinicalReview) {
        const hi = dto.language === 'hi' || /[ह-्]/.test(dto.input_text);
        responseType = 'clinical-review';
        content = {
          summary: hi
            ? 'आपका संदेश क्लिनिकल टीम को भेज दिया गया है।'
            : 'Your message has been sent to the clinical team.',
        };
        intent = 'clinical-review-message';
        selectedAgent = 'clinical-team';
      } else {
        let result;
        try {
          result = await this.processor.processTurn(
            sessionId,
            piiResult.sanitizedText,
            correlationId,
            identity,
            session.consentArtifactId,
          );
          responseType = result.responseType;
          content = result.content;
          intent = result.intent;
          selectedAgent = result.selectedAgent;

          if (result.responseType === 'escalation' && this.escalationService) {
            try {
              await this.escalationService.createFromSafety({
                identity,
                turn,
                safety: {
                  ruleId: content.escalation_id || 'RAGAS_THRESHOLD_BREACH',
                  ruleVersion: '1.0',
                  severity: 'HIGH',
                  status: 'ESCALATION_REQUIRED',
                  action: 'ESCALATE',
                  correlationId,
                  language: dto.language || 'en',
                  patientSafeMessage: content.summary || 'Clinical review required',
                },
                sanitizedInputText: piiResult.sanitizedText,
                structuredResponse: content,
              });
            } catch (escErr) {
              this.logger.error(`Failed to record post-processing escalation: ${escErr}`);
            }
          }
        } catch (err: any) {
          await this.failTurn(turn.id, err as Error, correlationId, identity);
          throw err;
        }
      }
    } else if (safetyResult.status === 'ESCALATION_REQUIRED') {
      // This contract is deterministic and ready before any best-effort HITL work.
      responseType = 'escalation';
      content = {
        summary:
          safetyResult.patientSafeMessage || 'Clinical escalation required.',
        escalation_id: safetyResult.ruleId || 'EMERGENCY_ESCALATION',
        reason:
          safetyResult.patientSafeMessage || 'Clinical escalation required.',
        assigned_role: 'CLINICIAN',
      };
      // An approved red-flag escalation enters the clinical-review path directly.
      // Facility lookup remains available for ordinary, explicit facility requests.
      intent = 'safety-escalation';
      selectedAgent = safetyResult.ruleId;

      if (this.escalationService) {
        try {
          await this.escalationService.createFromSafety({
            identity,
            turn,
            safety: safetyResult,
            sanitizedInputText: piiResult.sanitizedText,
            structuredResponse: content,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'unknown error';
          // Do not include raw input or PII in this operational log.
          this.logger.error(`Clinical escalation persistence failed rule=${safetyResult.ruleId} correlationId=${correlationId} reason=${reason}`);
        }
      }

      await this.recordEmergencyAudit('safety_escalated', correlationId, () => this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: turn.subjectRef,
        speaker: turn.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'safety_escalated',
        entityName: 'conversation_turn',
        entityId: turn.id,
        details: {
          rule_id: safetyResult.ruleId,
          rule_version: safetyResult.ruleVersion,
          severity: safetyResult.severity,
        },
      }));
    } else {
      // safetyResult.status === 'WITHHOLD'
      responseType = 'text';
      content = {
        en:
          safetyResult.patientSafeMessage ||
          'Response withheld due to safety policies.',
      };
      intent = 'safety-withhold';
      selectedAgent = safetyResult.ruleId;
      finalStatus = 'WITHHELD';

      await this.auditService.logEvent({
        tenantId: identity.tenantId,
        subjectAbhaRef: turn.subjectRef,
        speaker: turn.speaker,
        actingPrincipal: identity.externalId,
        correlationId,
        action: 'response_withheld',
        entityName: 'conversation_turn',
        entityId: turn.id,
        details: {
          rule_id: safetyResult.ruleId,
          rule_version: safetyResult.ruleVersion,
          severity: safetyResult.severity,
        },
      });
    }

    // Emergency content is already deterministic and conforms to Patient.tsx.
    if (this.responseFormatter && safetyResult.status !== 'ESCALATION_REQUIRED') {
      const formatted = this.responseFormatter.formatResponse({
        responseType,
        content,
        intent,
        selectedAgent,
        safetyStatus,
      });
      content = formatted.content;
    }

    // 8. Resolve the turn inside Transaction 2
    const resolved = await this.resolveTurn(
      turn.id,
      {
        responseType,
        content,
        intent,
        selectedAgent,
        safetyStatus,
      },
      correlationId,
      identity,
      finalStatus,
    );

    if (this.metricsService) {
      try {
        this.metricsService.recordTurn({
          intentCategory: intent || 'UNKNOWN',
          responseType,
          safetyStatus,
          durationMs: resolved.latency,
        });
        if (safetyStatus === 'WITHHELD') {
          this.metricsService.recordSafetyWithheld('MEDICAL_SAFETY');
        }
      } catch {
        // Fail-safe: metrics collection never blocks patient response
      }
    }

    return {
      turn_number: resolved.turnNumber,
      session_id: resolved.sessionId,
      response_type: resolved.responseType,
      content,
      correlation_id: resolved.correlationId,
      safety_status: resolved.safetyStatus,
      intent: resolved.intent || null,
      selected_agent: resolved.selectedAgent || null,
      latency: resolved.latency,
      created_at: resolved.createdAt.toISOString(),
    };
  }
}
