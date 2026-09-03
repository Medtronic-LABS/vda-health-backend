import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { HostIdentity } from '../auth/host-identity.context';
import { ClinicalEscalation, ClinicalEscalationOutcome, ClinicalResponseReviewDecision } from '../database/entities/clinical-escalation.entity';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { Session } from '../database/entities/session.entity';
import { FacilitySearchService } from '../facilities/facility-search.service';
import { PATIENT_DATA_PROVIDER, PatientDataProvider } from '../dev/patient-data/patient-data-provider.interface';
import { SafetyResult } from '../safety/interfaces/safety-gate.interface';

const CLINICIAN_RESPONSE_WINDOW_MS = 30_000;

type EmergencyFacilityOption = {
  name: string;
  state: string | null;
  district: string | null;
  city: string | null;
  address: string | null;
  contactNumber: string | null;
  hospitalType: string | null;
  schemes: string[];
  emergencyCapabilityVerified: boolean;
  distanceKm: number | null;
  travelTimeMinutes: number | null;
};

@Injectable()
export class EscalationService {
  constructor(
    @InjectRepository(ClinicalEscalation) private readonly escalations: Repository<ClinicalEscalation>,
    @InjectRepository(ConversationTurn) private readonly turns: Repository<ConversationTurn>,
    private readonly auditService: AuditService,
    @Optional()
    @InjectRepository(Session)
    private readonly sessions?: Repository<Session>,
    @Optional() private readonly facilitySearch?: FacilitySearchService,
    @Optional()
    @Inject(PATIENT_DATA_PROVIDER)
    private readonly patientData?: PatientDataProvider,
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

  private async clinicalConversation(escalation: ClinicalEscalation): Promise<Array<{ speaker: 'PATIENT' | 'CLINICIAN'; text: string; createdAt: Date }>> {
    const turns = await this.turns.find({ where: { clinicalEscalationId: escalation.id, conversationRetentionGranted: true }, order: { turnNumber: 'ASC' } });
    return turns.flatMap((turn) => {
      const text = turn.inputText?.trim();
      if (!text) return [];
      const speaker: 'PATIENT' | 'CLINICIAN' = turn.speaker === 'CLINICIAN' ? 'CLINICIAN' : 'PATIENT';
      return [{ speaker, text, createdAt: turn.createdAt }];
    });
  }

  /**
   * Emergency recommendations stay inside the existing structured facility
   * search. Patient location is resolved from the session's authorized subject
   * reference; no location, distance, service capability, or facility fact is
   * inferred here.
   */
  private async nearbyEmergencyFacilities(tenantId: string, sessionId: string): Promise<EmergencyFacilityOption[]> {
    if (!this.sessions || !this.patientData || !this.facilitySearch) return [];
    const session = await this.sessions.findOne({ where: { id: sessionId, tenantId } });
    if (!session) return [];
    const patient = await this.patientData.getPatientByReference(tenantId, session.subjectAbhaRef);
    if (!patient?.state && !patient?.district) return [];
    const results = await this.facilitySearch.searchWithSchemes(tenantId, {
      state: patient.state,
      district: patient.district,
      emergency: true,
      limit: 5,
    });
    return results.map((result) => ({
      name: result.facility.name,
      state: result.facility.state || null,
      district: result.facility.district || null,
      city: result.facility.city || null,
      address: result.facility.address || null,
      contactNumber: result.facility.contactNumber || null,
      hospitalType: result.facility.hospitalType || null,
      schemes: result.schemes,
      emergencyCapabilityVerified:
        result.facility.emergencyAvailable === true ||
        result.iphsOverlay?.emergencyCapability === 'SOURCE_REPORTED_CAPABLE',
      distanceKm: result.distanceKm,
      travelTimeMinutes: result.travelTimeMinutes,
    }));
  }

  /**
   * The browser may poll this state, but the server alone determines eligibility
   * from the persisted escalation timestamp. There is deliberately no provider
   * call here: the current project has no real teleconsultation integration.
   */
  async patientFallbackState(tenantId: string, sessionId: string): Promise<{
    reviewRequested: boolean;
    teleconsultationOffered: boolean;
    teleconsultationConfigured: boolean;
    clinicalChatState: 'WAITING_FOR_CLINICIAN' | 'CLINICIAN_CONNECTED' | 'ENDED';
    clinicianResponseDeadline: Date | null;
    firstClinicianResponseAt: Date | null;
    fallbackShownAt: Date | null;
    nearbyFacilities: EmergencyFacilityOption[];
    messages: Array<{ speaker: 'PATIENT' | 'CLINICIAN'; text: string; createdAt: Date }>;
  }> {
    const escalation = await this.escalations.findOne({
      where: { tenantId, sessionId },
      order: { createdAt: 'DESC' },
    });
    if (!escalation) {
      return {
        reviewRequested: false, teleconsultationOffered: false, teleconsultationConfigured: false,
        clinicalChatState: 'ENDED', clinicianResponseDeadline: null, firstClinicianResponseAt: null,
        fallbackShownAt: null, nearbyFacilities: [], messages: [],
      };
    }
    const messages = await this.clinicalConversation(escalation);
    if (escalation.status !== 'OPEN' || escalation.clinicalConversationClosedAt) {
      return {
        reviewRequested: false, teleconsultationOffered: false, teleconsultationConfigured: false,
        clinicalChatState: 'ENDED', clinicianResponseDeadline: null, firstClinicianResponseAt: null,
        fallbackShownAt: null, nearbyFacilities: [], messages,
      };
    }
    const firstClinicianResponseAt = messages.find((message) => message.speaker === 'CLINICIAN')?.createdAt || null;
    const clinicianResponded = Boolean(firstClinicianResponseAt);
    const clinicianResponseDeadline = new Date(escalation.createdAt.getTime() + CLINICIAN_RESPONSE_WINDOW_MS);

    const eligible = Date.now() >= clinicianResponseDeadline.getTime();
    if (eligible && !clinicianResponded && !escalation.teleconsultationOfferedAt) {
      const marked = await this.escalations.update(
        { id: escalation.id, tenantId, status: 'OPEN', teleconsultationOfferedAt: IsNull() },
        { teleconsultationOfferedAt: new Date() },
      );
      if (marked.affected) {
        await this.auditService.logEvent({
          tenantId,
          subjectAbhaRef: `escalation:${escalation.subjectRefHash}`,
          actingPrincipal: 'clinical-escalation-fallback',
          correlationId: escalation.correlationId,
          action: 'TELECONSULTATION_OFFERED',
          entityName: 'clinical_escalation',
          entityId: escalation.id,
          details: { delayed_seconds: CLINICIAN_RESPONSE_WINDOW_MS / 1000 },
        });
        escalation.teleconsultationOfferedAt = new Date();
      }
    }
    const fallbackShownAt = eligible && !clinicianResponded
      ? escalation.teleconsultationOfferedAt || null
      : null;
    const nearbyFacilities = fallbackShownAt
      ? await this.nearbyEmergencyFacilities(tenantId, sessionId)
      : [];
    return {
      reviewRequested: true,
      teleconsultationOffered: eligible && !clinicianResponded,
      teleconsultationConfigured: false,
      clinicalChatState: clinicianResponded ? 'CLINICIAN_CONNECTED' : 'WAITING_FOR_CLINICIAN',
      clinicianResponseDeadline,
      firstClinicianResponseAt,
      fallbackShownAt,
      nearbyFacilities,
      messages,
    };
  }

  async requestTeleconsultation(tenantId: string, sessionId: string): Promise<{
    teleconsultationConfigured: boolean;
  }> {
    const state = await this.patientFallbackState(tenantId, sessionId);
    if (!state.reviewRequested || !state.teleconsultationOffered) {
      throw new BadRequestException('TELECONSULTATION_FALLBACK_NOT_AVAILABLE');
    }
    const escalation = await this.escalations.findOne({ where: { tenantId, sessionId, status: 'OPEN', clinicalConversationClosedAt: IsNull() }, order: { createdAt: 'DESC' } });
    if (!escalation) throw new BadRequestException('TELECONSULTATION_FALLBACK_NOT_AVAILABLE');
    if (!escalation.teleconsultationRequestedAt) {
      const marked = await this.escalations.update(
        { id: escalation.id, tenantId, teleconsultationRequestedAt: IsNull() },
        { teleconsultationRequestedAt: new Date() },
      );
      if (marked.affected) {
        await this.auditService.logEvent({
          tenantId,
          subjectAbhaRef: `escalation:${escalation.subjectRefHash}`,
          actingPrincipal: 'patient',
          correlationId: escalation.correlationId,
          action: 'TELECONSULTATION_REQUESTED',
          entityName: 'clinical_escalation',
          entityId: escalation.id,
          details: { integration_configured: false },
        });
      }
    }
    // No STARTED or FAILED event is emitted: no real provider was configured or invoked.
    return { teleconsultationConfigured: false };
  }

  async recordPatientMessage(tenantId: string, sessionId: string, turn: ConversationTurn, actingPrincipal: string): Promise<boolean> {
    const escalation = await this.escalations.findOne({ where: { tenantId, sessionId, status: 'OPEN', clinicalConversationClosedAt: IsNull() }, order: { createdAt: 'DESC' } });
    if (!escalation) return false;
    turn.clinicalEscalationId = escalation.id;
    turn.speaker = 'PATIENT';
    await this.turns.save(turn);
    await this.auditService.logEvent({
      tenantId, subjectAbhaRef: turn.subjectRef, speaker: 'PATIENT', actingPrincipal,
      correlationId: turn.correlationId, action: 'PATIENT_MESSAGE_RECEIVED_IN_CLINICAL_REVIEW',
      entityName: 'clinical_escalation', entityId: escalation.id,
      details: { session_id: sessionId, turn_id: turn.id },
    });
    return true;
  }

  async sendClinicianMessage(tenantId: string, escalationId: string, actingPrincipal: string, message: string, correlationId: string, idempotencyKey?: string): Promise<{ speaker: 'CLINICIAN'; text: string; createdAt: Date }> {
    const escalation = await this.get(tenantId, escalationId);
    if (escalation.status !== 'OPEN' || escalation.clinicalConversationClosedAt) throw new BadRequestException('CLINICAL_CONVERSATION_NOT_OPEN');
    if (idempotencyKey) {
      const existing = await this.turns.findOne({ where: { clinicalEscalationId: escalation.id, idempotencyKey } });
      if (existing?.inputText) return { speaker: 'CLINICIAN', text: existing.inputText, createdAt: existing.createdAt };
    }
    const initialTurn = await this.turns.findOne({ where: { id: escalation.turnId, sessionId: escalation.sessionId } });
    if (!initialTurn) throw new NotFoundException('ESCALATION_CONVERSATION_NOT_FOUND');
    const lastTurn = await this.turns.findOne({ where: { sessionId: escalation.sessionId }, order: { turnNumber: 'DESC' } });
    const turn = this.turns.create({
      sessionId: escalation.sessionId, clinicalEscalationId: escalation.id,
      turnNumber: (lastTurn?.turnNumber || 0) + 1, correlationId, speaker: 'CLINICIAN',
      subjectRef: initialTurn.subjectRef,
      inputText: initialTurn.conversationRetentionGranted ? message.trim() : null,
      outputText: null, responseType: 'clinical-review-message', intent: 'clinical-review-message',
      selectedAgent: 'clinician', latency: 0, safetyStatus: 'CLINICAL_REVIEW', status: 'COMPLETED',
      idempotencyKey: idempotencyKey || null, conversationRetentionGranted: initialTurn.conversationRetentionGranted,
    });
    const saved = await this.turns.save(turn);
    await this.auditService.logEvent({
      tenantId, subjectAbhaRef: saved.subjectRef, speaker: 'CLINICIAN', actingPrincipal,
      correlationId, action: 'CLINICIAN_MESSAGE_SENT', entityName: 'clinical_escalation', entityId: escalation.id,
      details: { session_id: escalation.sessionId, turn_id: saved.id },
    });
    return { speaker: 'CLINICIAN', text: message.trim(), createdAt: saved.createdAt };
  }

  async endClinicalConversation(tenantId: string, escalationId: string, actingPrincipal: string): Promise<ClinicalEscalation & { clinicalConversation: Array<{ speaker: 'PATIENT' | 'CLINICIAN'; text: string; createdAt: Date }> }> {
    const escalation = await this.findScoped(tenantId, escalationId);
    if (escalation.clinicalConversationClosedAt) return this.get(tenantId, escalationId);
    if (escalation.status !== 'OPEN') throw new BadRequestException('CLINICAL_ESCALATION_NOT_OPEN');
    const closedAt = new Date();
    const marked = await this.escalations.update(
      { id: escalation.id, tenantId, status: 'OPEN', clinicalConversationClosedAt: IsNull() },
      { clinicalConversationClosedAt: closedAt, clinicalConversationClosedBy: actingPrincipal },
    );
    if (marked.affected) {
      await this.auditService.logEvent({
        tenantId,
        subjectAbhaRef: `escalation:${escalation.subjectRefHash}`,
        actingPrincipal,
        correlationId: escalation.correlationId,
        action: 'CLINICAL_CHAT_ENDED',
        entityName: 'clinical_escalation',
        entityId: escalation.id,
        details: { session_id: escalation.sessionId },
      });
    }
    return this.get(tenantId, escalationId);
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
    params.turn.clinicalEscalationId = saved.id;
    params.turn.speaker = 'PATIENT';
    await this.turns.save(params.turn);
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
    const query = this.escalations
      .createQueryBuilder('escalation')
      .where('escalation."tenantId" = :tenantId', { tenantId });
    if (filters.status) query.andWhere('escalation.status = :status', { status: filters.status });
    // A response review can remain OPEN, but an ended clinician chat is no
    // longer actionable. Keep those records available under All/history.
    if (filters.status === 'OPEN') query.andWhere('escalation."clinicalConversationClosedAt" IS NULL');
    if (filters.tier) query.andWhere('escalation.tier = :tier', { tier: filters.tier });
    if (filters.ruleId) query.andWhere('escalation."ruleId" = :ruleId', { ruleId: filters.ruleId });
    return query.orderBy('escalation."createdAt"', 'DESC').take(100).getMany();
  }

  private async findScoped(tenantId: string, id: string): Promise<ClinicalEscalation> {
    const escalation = await this.escalations.findOne({ where: { id, tenantId } });
    if (!escalation) throw new NotFoundException('CLINICAL_ESCALATION_NOT_FOUND');
    return escalation;
  }

  async get(tenantId: string, id: string): Promise<ClinicalEscalation & { clinicalConversation: Array<{ speaker: 'PATIENT' | 'CLINICIAN'; text: string; createdAt: Date }> }> {
    const escalation = await this.findScoped(tenantId, id);
    return Object.assign(escalation, { clinicalConversation: await this.clinicalConversation(escalation) });
  }

  async openCount(tenantId: string): Promise<{ open: number }> {
    return {
      open: await this.escalations.count({
        where: { tenantId, status: 'OPEN', clinicalConversationClosedAt: IsNull() },
      }),
    };
  }

  async review(tenantId: string, id: string, reviewer: HostIdentity, outcome: ClinicalEscalationOutcome, note?: string): Promise<ClinicalEscalation> {
    const escalation = await this.findScoped(tenantId, id);
    const reviewedAt = new Date();
    // Safety classification and clinician-chat lifecycle are independent. An
    // active conversation stays OPEN until the existing end-chat workflow.
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
    const escalation = await this.findScoped(tenantId, id);
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
