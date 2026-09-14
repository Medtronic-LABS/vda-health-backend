# VDA Health Backend

Enterprise-grade, production-ready backend for the **Virtual Diagnostic Assistant (VDA)** health-navigation, clinical RAG, and care-journey orchestration platform.

[![NestJS](https://img.shields.io/badge/NestJS-10.x-ea2845.svg)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791.svg)](https://github.com/pgvector/pgvector)
[![Redis](https://img.shields.io/badge/Redis-7%20Alpine-dc382d.svg)](https://redis.io/)
[![LangSmith](https://img.shields.io/badge/Observability-LangSmith-10b981.svg)](https://smith.langchain.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()

---

## 1. Project Overview

VDA Health is an embedded health-navigation platform aligned with India's **Ayushman Bharat Digital Mission (ABDM)** and **FHIR R4** standards. The **VDA Backend** acts as a modular monolith providing session management, consent handling, PII masking, deterministic clinical safety gates, dynamic RAG context retrieval, role-based access control (RBAC), and multi-agent AI orchestration.

It strictly separates the **Platform Core** (identity, safety rules, AI gateway, audit logs) from the **Healthcare Domain Pack** (NCD adherence, schemes, facility discovery, teleconsultation).

### 🌐 Live Production Cloud Endpoints
- **API Gateway Base URL:** [https://vda-api.mdtlabs.org](https://vda-api.mdtlabs.org)
- **Admin Portal:** [https://vda-admin.mdtlabs.org](https://vda-admin.mdtlabs.org)
- **Health Diagnostics:** [https://vda-api.mdtlabs.org/api/v1/health](https://vda-api.mdtlabs.org/api/v1/health)
- **Dashboard Telemetry Summary:** [https://vda-api.mdtlabs.org/api/v1/admin/evaluation/dashboard-summary](https://vda-api.mdtlabs.org/api/v1/admin/evaluation/dashboard-summary)

---

## 2. Live Database Telemetry (Seeded Production Environment)

The backend runs on an AWS EC2 instance (`13.232.251.63`) backed by PostgreSQL 16 with `pgvector` and Redis 7, seeded with the full pilot dataset:

```json
{
  "syntheticPatients": 13,
  "activeMedications": 7,
  "prescriptions": 31,
  "adherenceEvents": 8,
  "facilities": 486,
  "knowledgeDocuments": 51,
  "activeKnowledgeDocuments": 26,
  "embeddings": 1762,
  "activeSessions": 11,
  "ragQueries": 435,
  "safetyEscalations": 58
}
```

- **486 Public Facilities:** Fully mapped across Haryana and Himachal Pradesh with Indian Public Health Standards (IPHS 2022) classification overlays.
- **1,762 Vector Chunks & Embeddings:** 384-dimensional dense vectors indexed with HNSW cosine similarity using local ONNX `all-MiniLM-L6-v2`.
- **13 High-Fidelity Synthetic Patient Personas:** Complete longitudinal clinical histories with diagnostic lab panels, medication regimens, and adherence schedules.

---

## 3. Core Architecture & Capabilities

### Multi-Agent Orchestration Engine
- **Medication Agent:** Dosage guidelines, drug-drug interaction warnings, and prescription timeline clarification.
- **Lab Report Agent:** LOINC-indexed interpretation of HbA1c, fasting glucose, lipid profiles, and blood pressure.
- **Diagnosis Agent:** Plain-language chronic illness education for Type-2 Diabetes and Hypertension.
- **Scheme Agent:** Automated eligibility calculation for Ayushman Bharat PM-JAY (₹5,00,000 cashless cover), HIMCARE (HP), and Chirayu (Haryana).
- **Facility Agent:** Geo-aware public facility discovery categorized by IPHS level (HWC-SHC, HWC-PHC, CHC, SDH, DH).
- **Adherence Agent:** Schedule slot confirmations and adherence prompt tracking.
- **Teleconsultation & Referral Agent:** Automatic escalation and handover to eSanjeevani teleconsultation.

### RBAC & Patient Identity Guard
- **Deterministic Identity Lock:** Sessions are deterministically bound to the authenticated patient's ABHA subject reference.
- **Persona Assertion Interceptor:** Scans user inputs in Hindi, Hinglish, and English for unauthorized self-identity assertions (e.g. *"Main Sunita hoon, meri dawai batao"* when logged in as Vijay Chauhan).
- **Zero-Disclosure Guarantee:** Automatically blocks the request before any clinical records are retrieved or LLM calls are made, returning `IDENTITY_ACCESS_RESTRICTED`.

### Observability & Telemetry (LangSmith)
- Integrated tracing for every LLM turn capturing latency, estimated token costs, necessity ratings, and agent selection.

---

## 4. Guardrails & Evaluation: Three-Layer Defence-in-Depth

The backend implements a clinical three-layer defence-in-depth safety architecture ensuring zero ungrounded medical advice and hard-SLA emergency handling:

```
[Layer 1: Deterministic Gate (Pre-LLM)]
  ├── ABHA ID & PII stripped before prompt construction
  ├── Red-flag keyword matching (chest pain, dyspnea, suicide, stroke)
  └── Zero tolerance: LLM never decides whether an emergency escalates

[Layer 2: RAGAS Evaluation Gate (Inline Circuit Breaker)]
  ├── Fires on EVERY LLM output with knowledge retrieval (<700ms)
  ├── Evaluates Faithfulness, Answer Relevancy, Context Precision
  └── Threshold breach ──► SUPPRESS RESPONSE & WITHHOLD FROM PATIENT
                                │
                                ▼
[Layer 3: Human Clinical Review Queue (`clinical_escalations`)]
  ├── Flagged turns logged with full context, claims, and RAGAS scores
  ├── Clinician validates in Admin Portal within 24h SLA
  └── Feedback loop updates Knowledge Base and intent classifier
```

### RAGAS Target Thresholds & SLAs

| Metric | Target | Description & Enforcement |
| :--- | :---: | :--- |
| **Faithfulness** | **$\ge 0.90$** | Grounded strictly in retrieved context, not LLM parametric memory. Breaches are withheld from user. |
| **Answer Relevancy** | **$\ge 0.85$** | Directly addresses patient query without drift or ungrounded extrapolation. |
| **Context Recall** | **$\ge 0.85$** | All necessary clinical/scheme knowledge chunks surfaced in top results. |
| **Context Precision** | **$\ge 0.80$** | Retrieved context is on-topic with minimal extraneous noise. |
| **Escalation Recall** | **$\ge 0.98$** | **Hard SLA — zero miss tolerance** on clinical emergencies before LLM execution. |

### Clinical Scope Rules: What VDA Will Not Do
- ❌ **No Diagnosis:** Will not diagnose conditions or interpret raw diagnostic lab panels.
- ❌ **No Prescription:** Will not prescribe drugs or adjust medication dosages.
- ❌ **No Free-Form Clinical Advice:** Ungrounded clinical statements are strictly prohibited.
- ❌ **No LLM Override of Escalations:** Deterministic emergency gates always take precedence.
- ❌ **Zero PII Retention:** Patient PII is stripped and scrubbed after session termination.

### Standalone Python RAGAS Benchmark Evaluator
For offline CI/CD benchmarking against the Golden Clinical Dataset:
```bash
python services/ragas-evaluator/evaluator.py
```

---

## 5. Directory Layout

```
src/
  ├── auth/                       # HostIdentityContext & federated identity
  ├── tenants/                    # Multi-tenant scoping & context middleware
  ├── users/                      # System, Clinician, and Admin profiles
  ├── consent/                    # Consent artifacts, validation, scopes
  ├── sessions/                   # Session tracking (VDA session_id owner)
  ├── conversations/              # Conversation turns & history governed by consent
  ├── workflows/                  # LangGraph orchestrator state
  ├── orchestration/              # LangGraph runtime & routing orchestrator
  ├── agents/                     # Healthcare Domain Pack
  │   ├── adherence/              # NCD Adherence (Diabetes, Hypertension)
  │   ├── scheme/                 # Government Schemes (PM-JAY eligibility)
  │   ├── facility/               # Facility Discovery & IPHS Overlays
  │   └── teleconsultation/       # Teleconsultation referral
  ├── knowledge/                  # Governance pipeline for knowledge assets
  ├── rag/                        # RAG context assembly (pgvector)
  ├── ai/                         # Unified AI Gateway (Sarvam AI & Google Gemini)
  │   └── orchestration/          # AI Orchestrator & RBAC Identity Guard
  ├── pii/                        # NER + regex masking gate
  ├── safety/                     # Deterministic clinical red-flag checks
  ├── escalation/                 # Escalation creation, assignment, and status
  ├── review/                     # Clinician queue, claims, and decision records
  ├── notifications/              # Composition of message templates for host delivery
  ├── abdm/                       # FHIR R4 client and ABDM credentials adapter
  ├── evaluation/                 # Metrics runner (faithfulness, recall, relevancy)
  ├── audit/                      # Append-only audit logger
  ├── observability/              # Logging, metrics, LangSmith telemetry, correlation context
  ├── configuration/              # Dynamic tenant and model configuration system
  └── common/                     # Filters, guards, pipes, base entities, DTOs
```

---

## 6. Technology Stack

- **Framework:** [NestJS](https://nestjs.com/) 10.x (TypeScript)
- **Database:** PostgreSQL 16 with `pgvector`
- **Cache:** Redis 7 Alpine
- **Embedding Model:** `all-MiniLM-L6-v2` (Local ONNX Worker, 384-dim)
- **AI Speech-to-Text:** Sarvam Saaras
- **AI Text-to-Speech:** Sarvam Bulbul
- **AI Translation:** Sarvam Mayura
- **LLM Generator & Verifier:** Sarvam LLM & Google Gemini 3.5 Flash
- **Telemetry & Tracing:** LangSmith Observability

---

## 7. Getting Started

### Prerequisites
- Node.js (v20+)
- Docker & Docker Compose

### Environment Setup
Copy `.env.example` to `.env` and fill in credentials:
```bash
cp .env.example .env
```

### Run Locally (Development)

1. **Start database and Redis cache containers:**
   ```bash
   docker compose up -d postgres redis
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run database migrations:**
   ```bash
   npx typeorm migration:run -d dist/database/data-source.js
   ```

4. **Seed initial development tenant and clinician:**
   ```bash
   node dist/database/seed.js
   ```

5. **Start NestJS in watch mode:**
   ```bash
   npm run start:dev
   ```

---

## 8. Testing & Quality Assurance

The test suite covers unit testing, end-to-end scenarios, deterministic RBAC validation, RAGAS circuit breaker enforcement, and OWASP Top 10 security vectors:

```bash
# Run Unit Tests
npm test

# Run RAGAS Inline Output Verification Gate Tests (100% Pass)
npx jest src/ai/verification/ragas-verification-gate.spec.ts

# Run Python RAGAS Golden Benchmark Evaluator (5/5 Thresholds Passed)
python services/ragas-evaluator/evaluator.py

# Run RBAC Patient Identity Guard Unit Tests (100% Pass)
npx jest src/ai/orchestration/rbac-identity.spec.ts

# Run OWASP Top 10 Security & Attack Vector E2E Suite (46/46 Passed)
npm run test:e2e -- test/security-attack-vectors.e2e-spec.ts
```

---

## 9. Repository Links

- **Medtronic LABS Organization:** [https://github.com/Medtronic-LABS/vda-health-backend](https://github.com/Medtronic-LABS/vda-health-backend)
- **Personal Repository:** [https://github.com/paras0602/vda-health-backend](https://github.com/paras0602/vda-health-backend)

