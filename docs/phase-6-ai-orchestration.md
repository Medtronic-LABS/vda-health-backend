# Phase 6: AI Orchestration, Domain Agents & Gemini/Sarvam Integration

## Architectural Overview

Phase 6 introduces a provider-independent AI orchestration and domain agent layer for the Virtual Doctor Assistant (VDA) Health Backend. This architecture establishes a strict separation between safety validation, intent classification, domain-agent routing, provider execution, language processing, and transactional conversation turn resolution.

```
Incoming Patient Turn
          │
          ▼
┌───────────────────────────────────┐
│ Stage 1: PII Masking & Pre-Safety │
│ Gate (DevelopmentSafetyGate)      │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ Stage 2: Two-Stage Intent         │
│ Classifier (Deterministic → AI)   │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ Stage 3: Clinical Context Builder │
│ (ClinicalAiContextBuilder)        │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ Stage 4: Domain Agent Router      │
│ (AgentRouterService)              │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ Stage 5: AI Provider Execution    │
│ (Gemini 3.5 / Dev Provider)       │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ Stage 6: Indian Language Engine   │
│ (Sarvam / Dev Language Provider)  │
└─────────────────┬─────────────────┘
                  │
                  ▼
┌───────────────────────────────────┐
│ Stage 7: Post-Generation Safety   │
│ Validation Gate                   │
└─────────────────┬─────────────────┘
                  │
                  ▼
         Turn Resolution
```

---

## Key Components Implemented

### 1. Provider Interfaces & Abstractions (`src/ai/interfaces/`)
- `IAiProvider`: Provider-agnostic text generation and intent classification contract (`generate`, `classify`, `healthCheck`).
- `ILanguageProvider`: Indian language detection, translation, and text normalization interface (`detectLanguage`, `translate`, `normalizeIndianText`, `healthCheck`).

### 2. Provider Implementations (`src/ai/providers/`)
- **`GeminiProvider`**: Primary generative AI provider using official `@google/genai` standards with configurable model (`GEMINI_MODEL`, defaulting to `gemini-3.5-flash`), exponential backoff retries, and JSON mode support.
- **`SarvamProvider`**: Dedicated Indian language translation and language detection provider using configurable model (`SARVAM_MODEL`, defaulting to `mayura:v1`).
- **`DevelopmentAiProvider` & `DevelopmentLanguageProvider`**: Offline, fast deterministic development mocks used during test execution and isolated sandbox environments.

### 3. Intent Classification System (`src/ai/intents/`)
- **Two-Stage Classification Strategy**:
  - **Stage 1 (Deterministic/Rule-Engine)**: Fast regex matcher for common greetings, medication queries, lab reports, diagnoses, and allergies. Returns immediate classification with confidence $\ge 0.85$.
  - **Stage 2 (AI Classification)**: Fallback to `IAiProvider.classify()` when query is ambiguous or falls below rule confidence.

### 4. Domain Agent Architecture (`src/agents/`)
- **`IAgent` Interface**: Standardized agent contract (`agentId`, `supportedIntents`, `process()`).
- **Registered Domain Agents**:
  1. `MedicationAgent`: Handles active medication and prescription queries.
  2. `LabReportAgent`: Handles laboratory investigation and test result queries.
  3. `DiagnosisAgent`: Handles active clinical diagnosis queries.
  4. `AllergyAgent`: Handles recorded drug/food allergy queries.
  5. `GreetingAgent`: Handles patient greetings.
  6. `GeneralHealthAgent`: Handles general health & fallback advice.
- **`AgentRegistryService` & `AgentRouterService`**: Dynamically routes classified intents to the registered domain agent.

### 5. Dual Safety Boundary & Grounding Policy
- **Pre-Orchestration Safety**: PII masking and emergency pattern detection before AI invocation.
- **Prompt Injection Containment**: User queries are strictly wrapped inside `[PATIENT QUERY]` blocks with explicit system directives forbidding instruction override or clinical fabrication.
- **Post-Generation Safety Validation**: Generated output passes through `ISafetyGate.evaluateSafety()` before resolution. Emergency triggers transition the turn to `escalation` mode.

### 6. Phase 3 Split-Transaction Integrity
- Turn registration occurs in Transaction 1 (`PROCESSING`).
- AI Orchestration executes asynchronously outside PostgreSQL transaction locks.
- Turn resolution occurs in Transaction 2 (`COMPLETED`, `WITHHELD`, or `REJECTED`).

---

## Environment Configuration

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `AI_PROVIDER_ENABLED` | `boolean` | `false` | Enables live AI provider execution |
| `GEMINI_MODEL` | `string` | `gemini-3.5-flash` | Fully configurable Gemini model identifier |
| `GEMINI_API_KEY` | `string` | `""` | Google Gemini API key |
| `GEMINI_TIMEOUT_MS` | `number` | `10000` | Timeout per Gemini HTTP request |
| `GEMINI_MAX_RETRIES` | `number` | `2` | Max retry attempts with exponential backoff |
| `SARVAM_ENABLED` | `boolean` | `false` | Enables Sarvam Indian language API |
| `SARVAM_MODEL` | `string` | `mayura:v1` | Sarvam translation model identifier |
| `SARVAM_API_KEY` | `string` | `""` | Sarvam API subscription key |
| `SARVAM_TIMEOUT_MS` | `number` | `5000` | Timeout per Sarvam HTTP request |
| `AI_MAX_INPUT_LENGTH` | `number` | `2000` | Maximum character length for input prompt |
| `AI_MAX_OUTPUT_LENGTH` | `number` | `2000` | Maximum token limit for AI response |

---

## Verification Results

| Suite / Gate | Test Count | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Unit Tests** | 14 / 14 | **PASS** | `npm run test` |
| **E2E Tests (`ai-orchestration`)** | 17 / 17 | **PASS** | AI Orchestrator & Agents E2E |
| **E2E Tests (`clinical-context`)** | 12 / 12 | **PASS** | Clinical Context E2E |
| **E2E Tests (`pii-safety`)** | 37 / 37 | **PASS** | PII Protection & Safety Gate E2E |
| **E2E Tests (`turns`)** | 35 / 35 | **PASS** | Conversation Turn Lifecycle E2E |
| **E2E Tests (`session-consent`)** | 23 / 23 | **PASS** | Sessions & Host Identity E2E |
| **E2E Tests (`app`)** | 6 / 6 | **PASS** | Application Bootstrap & Health E2E |
| **Total E2E Coverage** | **130 / 130** | **PASS** | `npm run test:e2e` |
| **TypeScript Type Check** | 0 Errors | **PASS** | `npx tsc --noEmit` |
| **Production Build** | Exit 0 | **PASS** | `npm run build` |
| **ESLint Quality Gate** | 0 Errors | **PASS** | `npm run lint` |
