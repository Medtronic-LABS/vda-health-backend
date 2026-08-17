import {
  Injectable,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConsentService } from '../../consent/consent.service';
import { AuditService } from '../../audit/audit.service';
import {
  IHealthRecordService,
  HealthRecordCategory,
  HealthRecordRequest,
  RawHealthRecord,
} from '../interfaces/health-record-service.interface';
import {
  IClinicalContextService,
  ClinicalContextRequest,
} from '../interfaces/clinical-context-service.interface';
import {
  ClinicalContext,
  MedicationContext,
  PrescriptionContext,
  DiagnosisContext,
  LabResultContext,
  AllergyContext,
} from '../models/clinical-context.models';
import { IntentToRecordCategoryMapper } from '../mappers/intent-to-record-category.mapper';

/**
 * Staleness thresholds (days).
 * Records older than these thresholds are filtered from the AI context.
 * Configurable in future via environment variables or tenant configuration.
 */
const STALENESS_DAYS: Record<HealthRecordCategory, number | null> = {
  [HealthRecordCategory.MEDICATION]: 90,
  [HealthRecordCategory.PRESCRIPTION]: 90,
  [HealthRecordCategory.DIAGNOSIS]: 730, // 2 years — chronic conditions remain relevant
  [HealthRecordCategory.LAB_REPORT]: 180,
  [HealthRecordCategory.INVESTIGATION]: 180,
  [HealthRecordCategory.ALLERGY]: null, // Allergies never expire
};

@Injectable()
export class ClinicalContextService implements IClinicalContextService {
  private readonly logger = new Logger(ClinicalContextService.name);

  constructor(
    private readonly consentService: ConsentService,
    private readonly auditService: AuditService,
    @Inject('IHealthRecordService')
    private readonly healthRecordService: IHealthRecordService,
  ) {}

  async buildContext(
    request: ClinicalContextRequest,
  ): Promise<ClinicalContext> {
    const {
      sessionId,
      tenantId,
      subjectAbhaRef,
      vdaConsentArtifactId,
      intent,
      correlationId,
    } = request;

    // Opaque subject reference for audit events — never logs raw ABHA
    const { hash: subjectRef } = this.auditService.hashSubject(subjectAbhaRef);

    // ─── Audit: access requested ─────────────────────────────────────────────
    await this.auditService.logEvent({
      tenantId,
      subjectAbhaRef,
      actingPrincipal: 'clinical-context-service',
      correlationId,
      action: 'health_record_access_requested',
      entityName: 'ClinicalContext',
      entityId: sessionId,
      details: {
        intent,
        // No clinical values, no ABHA, no raw identifiers
      },
    });

    // ─── Step 1: Validate VDA record_read consent ────────────────────────────
    // This is Layer 1 of the dual-consent architecture.
    // Layer 2 (ABDM consent artefact) is validated by AbdmHealthRecordService (future).
    let consentArtifact;
    try {
      consentArtifact = await this.consentService.validateConsent(
        vdaConsentArtifactId,
        tenantId,
        subjectAbhaRef,
        ['record_read'],
      );
    } catch (err) {
      // Audit: access denied due to VDA consent failure
      await this.auditService.logEvent({
        tenantId,
        subjectAbhaRef,
        actingPrincipal: 'clinical-context-service',
        correlationId,
        action: 'health_record_access_denied',
        entityName: 'ConsentArtifact',
        entityId: vdaConsentArtifactId,
        details: {
          reason: 'VDA_CONSENT_MISSING_OR_INVALID',
          // No clinical values
        },
      });
      throw err; // Re-throw the ForbiddenException from ConsentService
    }

    // ─── Audit: access granted ───────────────────────────────────────────────
    await this.auditService.logEvent({
      tenantId,
      subjectAbhaRef,
      actingPrincipal: 'clinical-context-service',
      correlationId,
      action: 'health_record_access_granted',
      entityName: 'ConsentArtifact',
      entityId: vdaConsentArtifactId,
      details: {
        consentVersion: consentArtifact.consentVersion,
        // No clinical values
      },
    });

    // ─── Step 2: Map intent → required categories ────────────────────────────
    const categories = IntentToRecordCategoryMapper.getCategories(intent);

    // If intent maps to no categories, return empty context immediately
    if (categories.length === 0) {
      this.logger.log(
        `Intent '${intent}' maps to no categories — returning empty context`,
      );
      const emptyContext: ClinicalContext = {
        sessionId,
        subjectRef,
        intent,
        unavailableCategories: [],
        partialResult: false,
        retrievalTimestamp: new Date(),
        consentVersion: consentArtifact.consentVersion,
      };
      await this.emitClinicalContextCreatedAudit(
        tenantId,
        subjectAbhaRef,
        sessionId,
        correlationId,
        emptyContext,
      );
      return emptyContext;
    }

    // ─── Step 3: Fetch records via IHealthRecordService ──────────────────────
    const stalenessStart = this.computeEarliestDateForCategories(categories);
    const healthRequest: HealthRecordRequest = {
      subjectContext: {
        tenantId,
        subjectAbhaRef,
        sessionId,
        correlationId,
        abdmConsentArtefactRef: request.abdmConsentArtefactRef,
      },
      categories,
      dateRangeStart: stalenessStart ?? undefined,
    };

    let healthResult;
    try {
      healthResult = await this.healthRecordService.fetchRecords(healthRequest);
    } catch {
      this.logger.error(
        `Health record provider error: correlationId=${correlationId}`,
      );
      await this.auditService.logEvent({
        tenantId,
        subjectAbhaRef,
        actingPrincipal: 'clinical-context-service',
        correlationId,
        action: 'health_record_access_denied',
        entityName: 'IHealthRecordService',
        entityId: sessionId,
        details: { reason: 'PROVIDER_ERROR' },
      });
      throw new ServiceUnavailableException('HEALTH_RECORD_UNAVAILABLE');
    }

    // ─── Step 4: Audit: retrieved ────────────────────────────────────────────
    await this.auditService.logEvent({
      tenantId,
      subjectAbhaRef,
      actingPrincipal: 'clinical-context-service',
      correlationId,
      action: 'health_record_retrieved',
      entityName: 'IHealthRecordService',
      entityId: sessionId,
      details: {
        categoriesRequested: categories,
        categoriesFulfilled: healthResult.bundles.map((b) => b.category),
        unavailableCategories: healthResult.unavailableCategories,
        partialResult: healthResult.bundles.some((b) => b.partialResult),
        providerErrorCount: healthResult.providerErrorCodes.length,
        // NO clinical values, no medication names, no diagnoses, no lab values
      },
    });

    // ─── Step 5: Normalize, filter staleness, deduplicate, minimize ──────────
    const now = new Date();
    let medications: MedicationContext[] | undefined;
    let prescriptions: PrescriptionContext[] | undefined;
    let diagnoses: DiagnosisContext[] | undefined;
    let labResults: LabResultContext[] | undefined;
    let allergies: AllergyContext[] | undefined;

    for (const bundle of healthResult.bundles) {
      const records = this.applyStalnessFilter(
        bundle.records,
        bundle.category,
        now,
      );
      const deduped = this.deduplicateRecords(records);

      switch (bundle.category) {
        case HealthRecordCategory.MEDICATION:
          medications = deduped.map((r) => this.normalizeMedication(r, now));
          break;
        case HealthRecordCategory.PRESCRIPTION:
          prescriptions = deduped.map((r) =>
            this.normalizePrescription(r, now),
          );
          break;
        case HealthRecordCategory.DIAGNOSIS:
          diagnoses = deduped.map((r) => this.normalizeDiagnosis(r, now));
          break;
        case HealthRecordCategory.LAB_REPORT:
        case HealthRecordCategory.INVESTIGATION:
          labResults = [
            ...(labResults ?? []),
            ...deduped.map((r) => this.normalizeLabResult(r, now)),
          ];
          break;
        case HealthRecordCategory.ALLERGY:
          allergies = deduped.map((r) => this.normalizeAllergy(r, now));
          break;
      }
    }

    // ─── Step 6: Assemble ClinicalContext ────────────────────────────────────
    const context: ClinicalContext = {
      sessionId,
      subjectRef, // HMAC — never raw ABHA
      intent,
      unavailableCategories: healthResult.unavailableCategories,
      partialResult: healthResult.bundles.some((b) => b.partialResult),
      retrievalTimestamp: now,
      consentVersion: consentArtifact.consentVersion,
    };

    if (medications !== undefined) context.medications = medications;
    if (prescriptions !== undefined) context.prescriptions = prescriptions;
    if (diagnoses !== undefined) context.diagnoses = diagnoses;
    if (labResults !== undefined) context.labResults = labResults;
    if (allergies !== undefined) context.allergies = allergies;

    // ─── Audit: clinical context created ─────────────────────────────────────
    await this.emitClinicalContextCreatedAudit(
      tenantId,
      subjectAbhaRef,
      sessionId,
      correlationId,
      context,
    );

    return context;
  }

  // ---------------------------------------------------------------------------
  // Staleness filtering
  // ---------------------------------------------------------------------------

  private computeEarliestDateForCategories(
    categories: HealthRecordCategory[],
  ): Date | null {
    const now = new Date();
    let minDate: Date | null = null;

    for (const cat of categories) {
      const days = STALENESS_DAYS[cat];
      if (days === null) continue; // No staleness for this category
      const threshold = new Date(now.getTime() - days * 86400_000);
      if (minDate === null || threshold < minDate) {
        minDate = threshold;
      }
    }
    return minDate;
  }

  private applyStalnessFilter(
    records: RawHealthRecord[],
    category: HealthRecordCategory,
    now: Date,
  ): RawHealthRecord[] {
    const days = STALENESS_DAYS[category];
    if (days === null) return records; // No staleness filter

    const threshold = new Date(now.getTime() - days * 86400_000);
    return records.filter((r) => {
      const recordDate = r.payload['date'];
      if (!(recordDate instanceof Date)) return true; // Cannot determine — keep
      return recordDate >= threshold;
    });
  }

  // ---------------------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------------------

  private deduplicateRecords(records: RawHealthRecord[]): RawHealthRecord[] {
    const seen = new Set<string>();
    return records.filter((r) => {
      if (seen.has(r.sourceRef)) return false;
      seen.add(r.sourceRef);
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Safe string coercion
  // Avoids no-base-to-string on `unknown` payload values.
  // ---------------------------------------------------------------------------

  private safeStr(val: unknown, fallback: string): string {
    if (val == null) return fallback;
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Normalization — FHIR R4 → VDA models
  // Converts raw payload fields to typed context models.
  // AI-context fields only. sourceRef stripped from the context surface.
  // ---------------------------------------------------------------------------

  private normalizeMedication(
    r: RawHealthRecord,
    now: Date,
  ): MedicationContext {
    const p = r.payload;
    return {
      medicationName: this.safeStr(p['medicationName'], 'Unknown'),
      dosage: p['dosage'] != null ? this.safeStr(p['dosage'], '') : null,
      frequency:
        p['frequency'] != null ? this.safeStr(p['frequency'], '') : null,
      route: p['route'] != null ? this.safeStr(p['route'], '') : null,
      startDate: p['startDate'] instanceof Date ? p['startDate'] : null,
      endDate: p['endDate'] instanceof Date ? p['endDate'] : null,
      status: this.safeStr(p['status'], 'unknown'),
      sourceRef: r.sourceRef,
      retrievedAt: now,
    };
  }

  private normalizePrescription(
    r: RawHealthRecord,
    now: Date,
  ): PrescriptionContext {
    const p = r.payload;
    return {
      medicationName: this.safeStr(p['medicationName'], 'Unknown'),
      prescriptionDate:
        p['prescriptionDate'] instanceof Date ? p['prescriptionDate'] : null,
      prescribingProviderRef:
        p['prescribingProviderRef'] != null
          ? this.safeStr(p['prescribingProviderRef'], '')
          : null,
      instructions:
        p['instructions'] != null ? this.safeStr(p['instructions'], '') : null,
      status: this.safeStr(p['status'], 'unknown'),
      sourceRef: r.sourceRef,
      retrievedAt: now,
    };
  }

  private normalizeDiagnosis(r: RawHealthRecord, now: Date): DiagnosisContext {
    const p = r.payload;
    return {
      conditionName: this.safeStr(p['conditionName'], 'Unknown'),
      severity: p['severity'] != null ? this.safeStr(p['severity'], '') : null,
      onsetDate: p['onsetDate'] instanceof Date ? p['onsetDate'] : null,
      status: this.safeStr(p['status'], 'unknown'),
      sourceRef: r.sourceRef,
      retrievedAt: now,
    };
  }

  private normalizeLabResult(r: RawHealthRecord, now: Date): LabResultContext {
    const p = r.payload;
    return {
      testName: this.safeStr(p['testName'], 'Unknown'),
      value: p['value'] != null ? this.safeStr(p['value'], '') : null,
      unit: p['unit'] != null ? this.safeStr(p['unit'], '') : null,
      referenceRange:
        p['referenceRange'] != null
          ? this.safeStr(p['referenceRange'], '')
          : null,
      interpretation:
        p['interpretation'] != null
          ? this.safeStr(p['interpretation'], '')
          : null,
      observationDate:
        p['observationDate'] instanceof Date ? p['observationDate'] : null,
      sourceRef: r.sourceRef,
      retrievedAt: now,
    };
  }

  private normalizeAllergy(r: RawHealthRecord, now: Date): AllergyContext {
    const p = r.payload;
    return {
      allergen: this.safeStr(p['allergen'], 'Unknown'),
      reactionType:
        p['reactionType'] != null ? this.safeStr(p['reactionType'], '') : null,
      severity: p['severity'] != null ? this.safeStr(p['severity'], '') : null,
      status: this.safeStr(p['status'], 'unknown'),
      sourceRef: r.sourceRef,
      retrievedAt: now,
    };
  }

  // ---------------------------------------------------------------------------
  // Audit helpers
  // ---------------------------------------------------------------------------

  private async emitClinicalContextCreatedAudit(
    tenantId: string,
    subjectAbhaRef: string,
    sessionId: string,
    correlationId: string,
    context: ClinicalContext,
  ): Promise<void> {
    await this.auditService.logEvent({
      tenantId,
      subjectAbhaRef,
      actingPrincipal: 'clinical-context-service',
      correlationId,
      action: 'clinical_context_created',
      entityName: 'ClinicalContext',
      entityId: sessionId,
      details: {
        intent: context.intent,
        medicationCount: context.medications?.length ?? 0,
        prescriptionCount: context.prescriptions?.length ?? 0,
        diagnosisCount: context.diagnoses?.length ?? 0,
        labResultCount: context.labResults?.length ?? 0,
        allergyCount: context.allergies?.length ?? 0,
        unavailableCategoryCount: context.unavailableCategories.length,
        partialResult: context.partialResult,
        // NO clinical values: no medication names, diagnoses, lab values
      },
    });
  }
}
