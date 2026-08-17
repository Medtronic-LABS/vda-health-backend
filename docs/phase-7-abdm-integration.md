# Phase 7: Offline Health Record Foundation & ABDM Production Integration Boundary

## Executive Summary

Phase 7 establishes a provider-independent health record foundation and production boundary for the Virtual Doctor Assistant (VDA) Health Backend. 

Because production National Health Authority (NHA) ABDM credentials and Gateway specifications are pending approval, the system implements a **dual-provider strategy**:
1. **`DevelopmentHealthRecordService`**: An offline synthetic fixture provider that operates out-of-the-box without internet access or ABDM credentials.
2. **`AbdmHealthRecordService`**: A production-ready integration boundary incorporating HTTP client architecture, request/response abstractions, timeout management, retry loops, and error normalization.

---

## Architecture & Provider Selection

```
                         Patient Query
                               │
                               ▼
                    ClinicalContextService
                               │
                               ▼
                   ┌──────────────────────┐
                   │ IHealthRecordService │
                   │   Provider Factory   │
                   └──────────┬───────────┘
                              │
               ┌──────────────┴──────────────┐
               │                             │
    ABDM_ENABLED=false or          ABDM_ENABLED=true AND
     missing credentials            valid credentials
               │                             │
               ▼                             ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│DevelopmentHealthRecordService│ │   AbdmHealthRecordService    │
│  (Synthetic Dev Fixtures)    │ │   (Production ABDM Gateway)  │
└──────────────┬───────────────┘ └──────────────┬───────────────┘
               │                             │
               └──────────────┬──────────────┘
                              │
                              ▼
                 Normalized ClinicalContext
                              │
                              ▼
                     AI Orchestration
```

---

## 1. Implemented Features

- **Dynamic Provider Selection**: `AbdmModule` inspects configuration at runtime. If `ABDM_ENABLED=true` AND valid credentials exist, `AbdmHealthRecordService` is registered. Otherwise, it gracefully falls back to `DevelopmentHealthRecordService` with a warning log.
- **Application Startup Resilience**: Missing ABDM credentials NEVER crash application bootstrap.
- **Offline Health Fixtures**: `DevelopmentHealthRecordService` provides deterministic, synthetic health records covering:
  - **Medications**: Metformin 500mg, Amlodipine 5mg.
  - **Prescriptions**: Linked prescription records with dosage instructions.
  - **Lab Reports**: HbA1c (7.2%), Fasting Blood Glucose (128 mg/dL), Hemoglobin (13.5 g/dL).
  - **Diagnoses**: Type 2 Diabetes Mellitus, Essential Hypertension.
  - **Allergies**: Penicillin (Rash), Sulfonamides (Urticaria).
- **Labelled Fixtures**: All synthetic records are explicitly tagged with `[SYNTHETIC-DEV-FIXTURE]` in their source references.
- **Hindi Test Scenarios Verified**:
  - `"मैं अभी कौन कौन सी दवाई ले रहा हूं?"` → `MEDICATION_QUERY` → `MedicationAgent`
  - `"मेरी लैब रिपोर्ट में क्या आया है?"` → `LAB_RESULT_QUERY` → `LabReportAgent`
  - `"मेरी कौन सी बीमारी की जानकारी रिकॉर्ड में है?"` → `DIAGNOSIS_QUERY` → `DiagnosisAgent`
  - `"मुझे किस चीज़ से एलर्जी है?"` → `ALLERGY_QUERY` → `AllergyAgent`

---

## 2. Production ABDM Boundary (`AbdmHealthRecordService`)

- **HTTP Architecture**: Implemented with standard `fetch` and `AbortController` signal timeout handling (`ABDM_TIMEOUT_MS`).
- **Retry Handling**: Configurable exponential backoff retries (`ABDM_MAX_RETRIES`).
- **Error Normalization**: Normalizes HTTP 4xx/5xx and timeout errors into standardized VDA provider error codes (`ABDM_CONFIGURATION_INCOMPLETE`, `ABDM_FETCH_FAILED`).

---

## 3. Configuration Required Later

When production ABDM credentials arrive, enable live ABDM integration by configuring `.env`:

```env
# ABDM / Health Record Provider Configuration
ABDM_ENABLED=true
ABDM_BASE_URL=https://gateway.abdm.gov.in
ABDM_CLIENT_ID=your_production_client_id
ABDM_CLIENT_SECRET=your_production_client_secret
ABDM_HIU_ID=your_registered_hiu_id
ABDM_TIMEOUT_MS=10000
ABDM_MAX_RETRIES=2
```

No changes to downstream services (`ClinicalContextService`, `ClinicalAiContextBuilder`, `AiOrchestratorService`, `GeminiProvider`, `TurnsService`) will be required.

---

## 4. DECISION_REQUIRED Items (Pending NHA ABDM Documentation)

1. **OAuth2 Session Token Endpoint**: Confirm NHA production URL path (`/v0.5/sessions`) and auth request body schema.
2. **Push vs. Pull Data Exchange**: Confirm whether HIU data retrieval uses synchronous gateway response or asynchronous callback (`/v0.5/health-information/hiu/on-fetch`).
3. **ECDH Key Encryption**: Confirm public key exchange headers and Diffie-Hellman payload decryption algorithms.
4. **FHIR R4 Resource Profiles**: Confirm specific FHIR R4 profile constraints for Indian ABDM health records.
