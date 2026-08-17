# Phase 5: Clinical Context Service — Architecture & Implementation

> **Implementation Status**: COMPLETE (Offline Foundation)
> **ABDM Live Integration**: DECISION_REQUIRED — see Section 9
>
> Development implementation uses **synthetic health records only**.
> **No live ABDM APIs are called.**

---

## 1. What Was Implemented

Phase 5 implements the provider-independent Clinical Context foundation for VDA. It establishes the full architecture through which health records will eventually reach the AI orchestrator, without connecting to any live external system.

### Implemented Components

| File | Purpose |
|---|---|
| `src/abdm/interfaces/health-record-service.interface.ts` | `IHealthRecordService` — provider-independent retrieval contract |
| `src/abdm/interfaces/clinical-context-service.interface.ts` | `IClinicalContextService` — context assembly contract |
| `src/abdm/models/clinical-context.models.ts` | Normalized VDA models (FHIR-independent): `MedicationContext`, `PrescriptionContext`, `DiagnosisContext`, `LabResultContext`, `AllergyContext`, `ClinicalContext` |
| `src/abdm/mappers/intent-to-record-category.mapper.ts` | Static `IntentToRecordCategoryMapper` |
| `src/abdm/services/development-health-record.service.ts` | `DevelopmentHealthRecordService` — synthetic fixtures, never calls internet |
| `src/abdm/services/abdm-health-record.service.ts` | `AbdmHealthRecordService` — placeholder with DECISION_REQUIRED documentation |
| `src/abdm/services/clinical-context.service.ts` | `ClinicalContextService` — full orchestration |
| `src/abdm/abdm.module.ts` | NestJS module wiring all providers |
| `test/clinical-context.e2e-spec.ts` | 27 E2E tests |
| `docs/phase-5-clinical-context.md` | This document |

---

## 2. Architecture

```
Patient Message
    ↓
[Phase 4] PII Protection (DevelopmentPiiProtectionService)
    ↓
[Phase 4] Safety Gate (DevelopmentSafetyGate)
    ↓
[Phase 7/8] Intent Classification (FUTURE — not in Phase 5)
    ↓
ClinicalContextService                           ← Phase 5
    │
    ├─ 1. Validate VDA record_read consent       ← ConsentService (existing)
    │
    ├─ 2. Map intent → categories                ← IntentToRecordCategoryMapper
    │
    ├─ 3. Fetch records                          ← IHealthRecordService
    │         ↓
    │   DevelopmentHealthRecordService           ← Dev (synthetic fixtures)
    │         OR
    │   AbdmHealthRecordService                  ← Production (DECISION_REQUIRED)
    │
    ├─ 4. Apply staleness filter
    ├─ 5. Deduplicate records
    ├─ 6. Normalize → VDA typed models
    ├─ 7. Minimize fields
    ├─ 8. Assemble ClinicalContext
    └─ 9. Emit audit events
    ↓
ClinicalContext (compact, minimized)
    ↓
[Phase 7/8] AI Orchestrator (FUTURE — not in Phase 5)
```

**Critical rule**: The AI Orchestrator must NEVER directly call `IHealthRecordService`. It receives only the pre-assembled, minimized `ClinicalContext`.

---

## 3. Interfaces

### `IHealthRecordService`

```typescript
interface IHealthRecordService {
  fetchRecords(request: HealthRecordRequest): Promise<HealthRecordResult>;
}
```

Category-based retrieval. Only categories required by intent are requested. No method fetches all health records.

### `IClinicalContextService`

```typescript
interface IClinicalContextService {
  buildContext(request: ClinicalContextRequest): Promise<ClinicalContext>;
}
```

### `HealthRecordCategory` Enum

```
MEDICATION | PRESCRIPTION | DIAGNOSIS | LAB_REPORT | INVESTIGATION | ALLERGY
```

Future categories (ENCOUNTER, VITALS, CLINICAL_DOCUMENT) require DECISION_REQUIRED before adding.

---

## 4. Data Flow

```
ClinicalContextRequest
    { sessionId, tenantId, subjectAbhaRef, vdaConsentArtifactId, intent, correlationId }
    ↓
1. ConsentService.validateConsent(vdaConsentArtifactId, tenantId, subjectAbhaRef, ['record_read'])
    → ForbiddenException('CONSENT_MISSING') if any consent check fails
    ↓
2. IntentToRecordCategoryMapper.getCategories(intent)
    → [] for UNKNOWN / GENERAL_HEALTH_QUERY → return empty ClinicalContext immediately
    ↓
3. IHealthRecordService.fetchRecords({ subjectContext, categories, dateRangeStart })
    → HealthRecordResult { bundles[], unavailableCategories[], providerErrorCodes[] }
    ↓
4. applyStalnessFilter(records, category, now)
    → drops records older than per-category threshold (see Staleness Rules)
    ↓
5. deduplicateRecords(records)
    → drops records with duplicate sourceRef
    ↓
6. normalize*(record)
    → RawHealthRecord payload → typed VDA context model
    ↓
7. Field minimization — sourceRef excluded from AI surface
    ↓
8. ClinicalContext assembled
    → subjectRef = HMAC(subjectAbhaRef) — never raw
    → unavailableCategories populated
    → consentVersion snapshot from active consent artifact
    ↓
9. Audit events emitted (see Audit Model)
```

---

## 5. Consent Flow

### Two Distinct Consent Layers

| Layer | Name | Managed by | Purpose |
|---|---|---|---|
| **Layer 1** | VDA Consent Artifact | VDA (`consent_artifacts` table) | `record_read` scope — VDA authorization |
| **Layer 2** | ABDM Health Information Consent | ABDM Consent Manager (Patient App) | ABDM HIPs authorize release of records |

Both layers must be satisfied for health record retrieval in production. In the development implementation, only Layer 1 is enforced (Layer 2 is deferred — DECISION_REQUIRED).

### Layer 1 Enforcement (implemented)

```
vdaConsentArtifactId → ConsentService.validateConsent()
    ├─ consent not found → CONSENT_MISSING (403)
    ├─ tenantId mismatch → CONSENT_MISSING (403)
    ├─ subjectId mismatch → CONSENT_MISSING (403)
    ├─ status ≠ ACTIVE → CONSENT_MISSING (403)
    └─ 'record_read' scope absent → CONSENT_MISSING (403)
```

If any check fails: audit `health_record_access_denied` is emitted and `IHealthRecordService` is **never called**.

### Layer 2 (DECISION_REQUIRED)

The `abdmConsentArtefactRef` field on `ClinicalContextRequest` is reserved for future ABDM consent artefact validation inside `AbdmHealthRecordService`. The development implementation does not use it.

---

## 6. Identity and Tenant Isolation

- All records are scoped by `tenantId` + `subjectAbhaRef` from the verified `HostIdentity`.
- `subjectAbhaRef` must come from the validated session — **never** from patient-supplied request body.
- `DevelopmentHealthRecordService` enforces subject isolation by only serving records for the configured dev subject (`DEV_AUTH_SUBJECT_ABHA_REF`).
- Records for any other subject/tenant combination return empty results.
- `ClinicalContext.subjectRef` is always `HMAC-SHA256(subjectAbhaRef)` — the raw ABHA reference is never stored in the context object.

---

## 7. Record Categories and Staleness Rules

### Intent → Category Mapping

| Intent | Categories Fetched |
|---|---|
| `MEDICATION_QUERY` | MEDICATION, PRESCRIPTION |
| `PRESCRIPTION_QUERY` | PRESCRIPTION, MEDICATION |
| `LAB_RESULT_QUERY` | LAB_REPORT, INVESTIGATION |
| `DIAGNOSIS_QUERY` | DIAGNOSIS |
| `ALLERGY_QUERY` | ALLERGY |
| `GENERAL_HEALTH_QUERY` | *(none)* — DECISION_REQUIRED |
| `UNKNOWN` | *(none)* |
| *(unrecognised)* | *(none)* |

`GENERAL_HEALTH_QUERY` returns no records by design. Fetching all records for a generic query violates data minimization. Phase 7/8 must refine the intent or define a controlled subset.

### Staleness Thresholds

| Category | Threshold | Rationale |
|---|---|---|
| MEDICATION | 90 days | Active medications change frequently |
| PRESCRIPTION | 90 days | Recent prescriptions only |
| DIAGNOSIS | 730 days (2 years) | Chronic conditions remain relevant longer |
| LAB_REPORT | 180 days | Results older than 6 months rarely affect current advice |
| INVESTIGATION | 180 days | Same as LAB_REPORT |
| ALLERGY | **No filter** | Allergies are permanent safety data |

Records older than their threshold are silently filtered before the AI receives the context.

---

## 8. Data Normalization and Minimization

### Normalization

`DevelopmentHealthRecordService` returns records with a `payload: Record<string, unknown>`. `ClinicalContextService` normalizes these into typed VDA models.

The production `AbdmHealthRecordService` will convert FHIR R4 resources into the same `payload` format inside the adapter, so `ClinicalContextService` normalization logic remains unchanged.

### Field Minimization

| Model | Fields in `ClinicalContext` | Fields Stripped |
|---|---|---|
| `MedicationContext` | name, dosage, frequency, route, startDate, endDate, status | Raw source IDs, ABHA ref |
| `PrescriptionContext` | name, prescriptionDate, providerRef (opaque), instructions, status | Raw patient identifiers |
| `DiagnosisContext` | conditionName, severity, onsetDate, status | Raw source IDs |
| `LabResultContext` | testName, value, unit, referenceRange, interpretation, observationDate | Raw source IDs |
| `AllergyContext` | allergen, reactionType, severity, status | Raw source IDs |

Note: `sourceRef` is present in the typed models for internal provenance tracing. When the AI Orchestrator (Phase 7/8) receives `ClinicalContext`, an additional minimization step may strip `sourceRef` fields. This is deferred to Phase 7/8.

---

## 9. Security

### What Is Never Logged, Stored, or Exposed

| Item | Where it's blocked |
|---|---|
| Raw `subjectAbhaRef` | Replaced with HMAC in all audit events; never in cache keys, logs, or error messages |
| Raw FHIR bundles | Never stored; normalized and discarded immediately |
| Medication names in audit | Audit details contain only counts, not values |
| Lab result values in audit | Same — counts only |
| Diagnosis names in audit | Same — counts only |
| Access tokens / consent tokens | Never logged by any VDA component |
| Raw provider identifiers | `sourceRef` is opaque; raw HIP IDs are not exposed |

### Application Log Policy

```
MUST NEVER LOG:           SAFE TO LOG:
─────────────────────     ─────────────────────
subjectAbhaRef            correlationId
Medication names          sessionId
Diagnosis names           tenantId
Lab result values         intent
Allergen names            record categories (enum names)
Raw FHIR bundles          error type codes
ABDM tokens               HTTP status codes
```

### No Redis Caching (Phase 5)

Clinical context caching in Redis is **not implemented** in Phase 5. The design proposed Redis caching, but this requires organizational and DPDP Act policy approval before implementation.

`ClinicalContextService` is architected so caching can be added as a decorator or wrapper without changing its public interface.

**DECISION_REQUIRED**: Whether caching any clinical data in Redis is acceptable under DPDP Act requirements and the host organization's data handling policy.

---

## 10. Audit Model

All audit events use the existing `AuditService` with HMAC-based subject references.

| Event | When Fired | Safe Details |
|---|---|---|
| `health_record_access_requested` | Start of `buildContext()` | intent |
| `health_record_access_granted` | After VDA consent validation passes | consentVersion |
| `health_record_access_denied` | VDA consent failure OR provider error | reason code only |
| `health_record_retrieved` | After `IHealthRecordService.fetchRecords()` returns | category names, counts, partialResult flag |
| `clinical_context_created` | After `ClinicalContext` assembled | intent, record counts per category — **no clinical values** |

---

## 11. Failure Handling

| Failure | VDA Behavior | AI Receives |
|---|---|---|
| VDA consent missing/expired/withdrawn | 403 CONSENT_MISSING | N/A — turn not processed |
| Intent maps to no categories | Empty `ClinicalContext` returned | Empty context with no records |
| `IHealthRecordService` throws | 503 HEALTH_RECORD_UNAVAILABLE | N/A |
| Provider returns partial results | `partialResult: true` in context | `partialResult: true`, `unavailableCategories` populated |
| All records stale | Empty arrays in context | AI must acknowledge unavailability |
| Empty records | Valid empty arrays | `medications: []` etc. |
| Subject isolation violation | Empty results from dev provider | N/A |

**VDA must never fabricate clinical data.** The AI Orchestrator must use the `unavailableCategories` list to generate responses that acknowledge unavailable data.

---

## 12. DECISION_REQUIRED Items for Live ABDM Integration

The following must be resolved before `AbdmHealthRecordService` can be implemented:

| # | Item | Blocking? |
|---|---|---|
| DR-1 | ABDM HIE-CM/HIU API specification from NHA (sandbox + production) | **Yes** |
| DR-2 | ABDM Gateway base URL (sandbox + production) | **Yes** |
| DR-3 | HIU client credential type and registration procedure | **Yes** |
| DR-4 | FHIR R4 resource profiles used in ABDM India | **Yes — cannot build FhirNormalizer** |
| DR-5 | Push vs. Pull data model for ABDM HIE | **Yes — architectural impact** |
| DR-6 | Host app → VDA mechanism to pass ABDM consent artefact reference | **Yes** |
| DR-7 | Trust model for `subjectAbhaRef` in `HostIdentity` (ADR-002) | **Yes** |
| DR-8 | Request signing / ECDH encryption requirements | **Yes** |
| DR-9 | Redis clinical context caching — DPDP/policy approval | Yes |
| DR-10 | `GENERAL_HEALTH_QUERY` intent scope definition | Yes |
| DR-11 | `Encounter`, `Vitals`, `ClinicalDocument` record types inclusion | No (deferred) |
| DR-12 | Cache encryption key management approach | Yes (if DR-9 approved) |

---

## 13. Recommended Path to Live ABDM Integration

Once DR-1 through DR-8 are resolved, implement in this order:

1. `FhirNormalizer` — FHIR R4 resources → VDA payload format (DR-4 required)
2. `AbdmHttpClient` — ABDM Gateway HTTP client with auth, timeout, retry (DR-1, DR-2, DR-3 required)
3. `AbdmHealthRecordService` — adapter connecting `AbdmHttpClient` + `FhirNormalizer` (all DRs required)
4. Feature flag `ABDM_ENABLED=true` in `AbdmModule` to swap provider
5. Redis caching layer (if DR-9 approved)
6. Full E2E tests against ABDM sandbox environment
