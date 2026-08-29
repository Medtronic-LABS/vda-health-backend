import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { HostIdentity } from '../auth/host-identity.context';
import { ClinicalEscalation, ClinicalEscalationOutcome, ClinicalEscalationStatus, ClinicalResponseReviewDecision } from '../database/entities/clinical-escalation.entity';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { SafetyResult } from '../safety/interfaces/safety-gate.interface';

@Injectable()
export class EscalationService {
  constructor(
    @InjectRepository(ClinicalEscalation) private readonly escalations: Repository<ClinicalEscalation>,
    private readonly auditService: AuditService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  private responseContext(content: Record<string, unknown>): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    for (const key of ['summary', 'reason', 'escalation_id', 'assigned_role', 'cards', 'facility_results', 'actions', 'emergency_capability_note']) {
      if (content[key] !== undefined) context[key] = content[key];
    }
    return context;
  }

  private correctedResponseContext(escalation: ClinicalEscalation, correctedResponse: string): Record<string, unknown> | null {
    if (!escalation.originalResponseContext) return null;
    return { ...escalation.originalResponseContext, summary: correctedResponse, reason: correctedResponse };
  }

  private storedResponseContext(outputText?: string | null): Record<string, unknown> | null {
    if (!outputText) return null;
    try {
      const parsed: unknown = JSON.parse(outputText);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? this.responseContext(parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  async createFromSafety(params: { identity: HostIdentity; turn: ConversationTurn; safety: SafetyResult; sanitizedInputText: string; structuredResponse?: Record<string, unknown> }): Promise<ClinicalEscalation | null> {
    if (params.safety.status !== 'ESCALATION_REQUIRED') return null;
    const escalation = this.escalations.create({
      tenantId: params.identity.tenantId,
      turnId: params.turn.id,
      sessionId: params.turn.sessionId,
      subjectRefHash: this.auditService.hashSubject(params.turn.subjectRef).hash,
      correlationId: params.safety.correlationId,
      // Existing HIGH rules create T1 cases; this does not define any new clinical rule.
      tier: params.safety.severity === 'HIGH' ? 'T1' : 'T2',
      clinicalCategory: (params.safety.ruleId || 'ESCALATION').replace(/_\d+$/, ''),
      ruleId: params.safety.ruleId || 'ESCALATION',
      ruleVersion: params.safety.ruleVersion,
      language: params.safety.language,
      sanitizedInputText: params.turn.conversationRetentionGranted ? params.sanitizedInputText : null,
      patientSafeResponse: params.safety.patientSafeMessage,
      originalPatientResponse: params.safety.patientSafeMessage,
      originalResponseContext: this.responseContext(params.structuredResponse || {}),
      status: 'OPEN',
      reviewHistory: [{ action: 'CREATED', at: new Date().toISOString() }],
    });
    const saved = await this.escalations.save(escalation);
    await this.auditService.logEvent({
      tenantId: params.identity.tenantId, subjectAbhaRef: params.turn.subjectRef,
      speaker: params.turn.speaker, actingPrincipal: params.identity.externalId,
      correlationId: params.safety.correlationId, action: 'clinical_escalation_created',
      entityName: 'clinical_escalation', entityId: saved.id,
      details: { tier: saved.tier, clinical_category: saved.clinicalCategory, rule_id: saved.ruleId, rule_version: saved.ruleVersion, safety_status: params.safety.status },
    });
    return saved;
  }

  async list(tenantId: string, filters: { status?: string; tier?: string; ruleId?: string }) {
    const where: Record<string, string> = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.tier) where.tier = filters.tier;
    if (filters.ruleId) where.ruleId = filters.ruleId;
    return this.escalations.find({ where, order: { createdAt: 'DESC' }, take: 100 });
  }

  async get(tenantId: string, id: string): Promise<ClinicalEscalation> {
    const escalation = await this.escalations.findOne({ where: { id, tenantId } });
    if (!escalation) throw new NotFoundException('CLINICAL_ESCALATION_NOT_FOUND');
    return escalation;
  }

  async openCount(tenantId: string): Promise<{ open: number }> {
    return { open: await this.escalations.count({ where: { tenantId, status: 'OPEN' } }) };
  }

  async review(tenantId: string, id: string, reviewer: HostIdentity, outcome: ClinicalEscalationOutcome, note?: string): Promise<ClinicalEscalation> {
    const escalation = await this.get(tenantId, id);
    const reviewedAt = new Date();
    const status: ClinicalEscalationStatus = outcome === 'TRUE_POSITIVE' ? 'TRUE_POSITIVE' : outcome === 'FALSE_POSITIVE' ? 'FALSE_POSITIVE' : 'REVIEWED';
    escalation.status = status;
    escalation.reviewOutcome = outcome;
    escalation.reviewerId = reviewer.externalId;
    escalation.reviewerNote = note?.trim() || null;
    escalation.reviewedAt = reviewedAt;
    escalation.reviewHistory = [...(escalation.reviewHistory || []), { action: 'SAFETY_CLASSIFIED', outcome, reviewerId: reviewer.externalId, reviewedAt: reviewedAt.toISOString() }];
    const saved = await this.escalations.save(escalation);
    await this.auditService.logEvent({
      tenantId, subjectAbhaRef: `escalation:${saved.subjectRefHash}`,
      actingPrincipal: reviewer.externalId, correlationId: saved.correlationId,
      action: 'clinical_escalation_reviewed', entityName: 'clinical_escalation', entityId: saved.id,
      details: { outcome, status: saved.status, rule_id: saved.ruleId, tier: saved.tier },
    });
    return saved;
  }

  async reviewResponse(
    tenantId: string,
    id: string,
    reviewer: HostIdentity,
    decision: ClinicalResponseReviewDecision,
    note?: string,
    correctedResponse?: string,
  ): Promise<ClinicalEscalation> {
    const escalation = await this.get(tenantId, id);
    const originalResponse = escalation.originalPatientResponse || escalation.patientSafeResponse || null;
    const normalizedCorrection = correctedResponse?.trim();
    if (decision === 'CORRECTED' && !normalizedCorrection) {
      throw new BadRequestException('CORRECTED_RESPONSE_REQUIRED');
    }
    const reviewedAt = new Date();
    escalation.originalPatientResponse = originalResponse;
    escalation.responseReviewDecision = decision;
    escalation.correctedPatientResponse = decision === 'CORRECTED' ? normalizedCorrection! : null;
    escalation.responseReviewerId = reviewer.externalId;
    escalation.responseReviewedAt = reviewedAt;
    if (escalation.status === 'OPEN') escalation.status = 'REVIEWED';
    escalation.reviewHistory = [
      ...(escalation.reviewHistory || []),
      {
        action: decision,
        reviewerId: reviewer.externalId,
        reviewedAt: reviewedAt.toISOString(),
        originalResponse,
        correctedResponse: decision === 'CORRECTED' ? normalizedCorrection : undefined,
        note: note?.trim() || undefined,
      },
    ];
    if (decision === 'CORRECTED' && this.dataSource) {
      await this.dataSource.transaction(async (manager) => {
        const turn = await manager.findOne(ConversationTurn, {
          where: { id: escalation.turnId, sessionId: escalation.sessionId },
        });
        if (!escalation.originalResponseContext) {
          escalation.originalResponseContext = this.storedResponseContext(turn?.outputText);
        }
        const correctedContext = this.correctedResponseContext(escalation, normalizedCorrection!);
        if (turn?.outputText && correctedContext) {
          // Retain source-backed facility cards and every other existing structured component.
          turn.outputText = JSON.stringify(correctedContext);
          await manager.save(turn);
        }
        await manager.save(ClinicalEscalation, escalation);
      });
    } else {
      await this.escalations.save(escalation);
    }
    const saved = escalation;
    const action = decision === 'APPROVED'
      ? 'clinical_response_approved'
      : decision === 'CORRECTED'
        ? 'clinical_response_corrected'
        : 'clinical_response_annotated';
    await this.auditService.logEvent({
      tenantId,
      subjectAbhaRef: `escalation:${saved.subjectRefHash}`,
      actingPrincipal: reviewer.externalId,
      correlationId: saved.correlationId,
      action,
      entityName: 'clinical_escalation',
      entityId: saved.id,
      details: { decision, rule_id: saved.ruleId, tier: saved.tier, patient_delivery_configured: false },
    });
    return saved;
  }
}
