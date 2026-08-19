# Phase 8 — Patient Conversation Experience, Context-Aware Responses & Production VDA Workflow

## Overview
Phase 8 implements the production-grade **Hindi-First Patient Conversation Experience** on top of the existing VDA Health Backend. It enables patients to ask natural healthcare queries in **Hindi (Devanagari)**, **Hinglish**, or **English** and receive empathetic, clinically safe, and strictly grounded responses based on their authorized health records.

---

## Key Architecture & Components

```
Patient Request
    ↓
Authentication / Host Identity
    ↓
Session Validation & Consent Check
    ↓
PII Sanitization & Audit
    ↓
Safety Gate (Input Pre-Processing)
    ↓
Two-Stage Intent Classification
    ↓
Agent Routing
    ↓
ClinicalContextService (Development / ABDM Provider)
    ↓
ConversationHistoryService (Consent-Enforced Bounded Context)
    ↓
Clinical AI Context Builder & Prompt Security Directives
    ↓
Gemini 3.5 AI Provider (with Fallback to Domain Agent)
    ↓
Sarvam Language Provider (Indian Language Normalization / Fallback)
    ↓
Post-Generation Safety Gate Evaluation
    ↓
ConversationResponseFormatter (Structured Clinical Cards)
    ↓
Turn Resolution & Audit Logging
    ↓
Patient Response
```

---

## Features & Implementation Details

### 1. Hindi-First Language Experience
- Native support for Devanagari Hindi, English, and Hinglish queries.
- Preserves clinical values, numbers, and units without mis-translation (e.g., `HbA1c 7.2%`, `128 mg/dL`).
- Integrates Sarvam AI for Indian language processing with automatic fallback to `DevelopmentLanguageProvider`.

### 2. Clinical Context Grounding & Zero Hallucination
- Grounding Policy: Answers clinical questions **ONLY** from the authorized `ClinicalContext`.
- If requested clinical records (medications, lab reports, diagnoses, allergies) are missing or empty, explicitly states that information is not available in their health records (e.g., `"मुझे उपलब्ध स्वास्थ्य रिकॉर्ड में इसकी जानकारी नहीं मिली।"`).

### 3. Structured Clinical Cards
Responses return patient-friendly text alongside structured cards for frontend/mobile apps:
- `medications`: Array of `{ name, dosage, frequency, status, instructions }`
- `lab_results`: Array of `{ test_name, value, unit, reference_range, observation_date, interpretation }`
- `diagnoses`: Array of `{ condition_name, severity, onset_date, status }`
- `allergies`: Array of `{ allergen, reaction_type, severity, status }`

### 4. Bounded Conversational Follow-Up Continuity
- Multi-turn follow-up queries (e.g. "इनमें से पहली वाली दवा के बारे में बताओ").
- **Consent Enforcement**: Checks `conversation_retention` scope before retrieving previous turn history. If retention was not granted, raw text is never retrieved from database.
- Bounded limits: `CONVERSATION_CONTEXT_MAX_TURNS` (default: 3) and `CONVERSATION_CONTEXT_MAX_CHARS` (default: 1000).

### 5. Prompt Security & Isolation Boundaries
- Explicit prompt structure separating `[SYSTEM INSTRUCTIONS]`, `[AUTHORIZED CLINICAL CONTEXT]`, `[CONVERSATION HISTORY]`, and `[PATIENT QUERY]`.
- Protects against prompt injection attacks, instruction overrides, and requests to leak ABHA identifiers or secret tokens.

### 6. Safety & Privacy Gates
- Pre- and Post-generation safety validation against medical safety policies.
- Emergency triggers (chest pain, severe breathing difficulty) route to `escalation` response type.
- Unsafe medication change requests (stopping or changing dose) are withheld with a clinician consultation warning.

### 7. Audit Observability & Offline Mode
- Enriched audit logging (`conversation_started`, `context_used`, `response_generated`, `response_safety_checked`, `conversation_completed`, `conversation_failed`).
- Zero PII, ABHA, Aadhaar, secrets, or raw clinical values in audit logs.
- `ABDM_ENABLED=false` remains the default with `DevelopmentHealthRecordService` fixtures. Zero external credentials required for local development.

---

## Test Scenarios & Verification
All 30 E2E test scenarios in `test/patient-conversation.e2e-spec.ts` pass 100%:

1. Hindi Medication Query ("मैं अभी कौन कौन सी दवाई ले रहा हूं?")
2. Hinglish Medication Query ("Main kaunsi medicines le raha hoon?")
3. English Medication Query ("What medicines am I currently taking?")
4. Hindi Lab Query ("मेरी लैब रिपोर्ट में क्या आया है?")
5. Hindi HbA1c Query ("मेरा HbA1c कितना है?")
6. Hindi Diagnosis Query ("मेरी कौन सी बीमारी रिकॉर्ड में है?")
7. Hindi Allergy Query ("मुझे किस चीज से एलर्जी है?")
8. General Health Query ("स्वस्थ रहने के लिए क्या करूं?")
9. Greeting without Context Retrieval ("नमस्ते")
10. Follow-up Turn Continuity ("इनमें से पहली वाली क्यों दी गई है?")
11. Missing Clinical Information Non-Availability Message
12. Hallucination Prevention
13. Prompt Injection Containment
14. PII Protection (Email/Phone Sanitized)
15. Emergency Escalation Trigger
16. Unsafe Medication Change Withheld
17. Conversation Retention Enabled
18. Conversation Retention Disabled
19. Consent Enforcement (`CONSENT_MISSING`)
20. Tenant Isolation (`TENANT_ACCESS_DENIED`)
21. Session Expiration
22. Session Closed
23. Idempotent Turn Request
24. Correlation ID Propagation
25. AI Provider Fallback
26. Sarvam Provider Fallback
27. ABDM Unavailable Fallback
28. Structured Medication Response Card
29. Structured Lab Response Card
30. Full End-to-End Hindi Multi-Turn Patient Conversation Lifecycle
