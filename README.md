# VDA Health Backend

Enterprise-grade, prototype-ready backend for the VDA (Virtual Diagnostic Assistant) Health navigation and care-journey orchestration platform.

---

## 1. Project Overview

VDA Health is an embedded health-navigation platform. The **VDA Backend** acts as a modular monolith providing session management, consent handling, PII masking, safety gates, dynamic RAG context retrieval, and AI orchestration.

It strictly separates the **Platform Core** (identity, safety rules, AI gateway, audit logs) from the **Healthcare Domain Pack** (NCD adherence, schemes, facility discovery).

---

## 2. Directory Layout

The codebase is organized as follows:

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
  │   ├── facility/               # Facility Discovery
  │   └── teleconsultation/       # Teleconsultation referral
  ├── knowledge/                  # Governance pipeline for knowledge assets
  ├── rag/                        # RAG context assembly
  ├── ai/                         # Unified AI Gateway (Sarvam, Gemini)
  ├── pii/                        # NER + regex masking gate
  ├── safety/                     # Deterministic clinical red-flag checks
  ├── escalation/                 # Escalation creation, assignment, and status
  ├── review/                     # Clinician queue, claims, and decision records
  ├── notifications/              # Composition of message templates for host delivery
  ├── abdm/                       # FHIR R4 client and ABDM credentials adapter
  ├── evaluation/                 # Metrics runner (faithfulness, recall, relevancy)
  ├── audit/                      # Append-only audit logger
  ├── observability/              # Logging, metrics, OpenTelemetry, correlation context
  ├── configuration/              # Dynamic tenant and model configuration system
  └── common/                     # Filters, guards, pipes, base entities, DTOs
```

---

## 3. Technology Stack

- **Framework**: [NestJS](https://nestjs.com/) (TypeScript)
- **Database**: PostgreSQL with `pgvector`
- **Cache**: Redis
- **Orchestration**: LangGraph
- **Speech-to-Text**: Sarvam Saaras
- **Translation**: Sarvam Translation
- **LLM Generator**: Sarvam LLM
- **LLM Verifier**: Gemini 3.5 (Configurable via `GEMINI_MODEL_ID`)
- **Text-to-Speech**: Sarvam Bulbul
- **Clinical Data**: ABDM / FHIR R4
- **Evaluation**: RAGAS (Asynchronous)

---

## 4. Getting Started

### Prerequisites

- Node.js (v20+)
- Docker and Docker Compose

### Environment Setup

Copy `.env.example` to `.env` and fill in the required credentials (e.g., Sarvam AI and Gemini API keys):

```bash
cp .env.example .env
```

### Run Locally (Development)

1. Start database and cache dependencies in Docker:
   ```bash
   docker-compose up -d postgres redis
   ```

2. Install project dependencies:
   ```bash
   npm install
   ```

3. Run the NestJS application in watch mode:
   ```bash
   npm run start:dev
   ```

### Run the Entire Stack inside Docker

Build and run the app, database, and cache altogether:
```bash
docker-compose up --build
```

---

## 5. Health Check Endpoint

When the application is running, the health check is accessible at:
- **URL**: `http://localhost:3000/api/v1/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-08-16T13:30:00.000Z",
    "services": {
      "database": "up",
      "cache": "up"
    }
  }
  ```

---

## 6. Active Integration Decisions (DECISION_REQUIRED)

The following parameters must not be hardcoded or resolved without external engineering alignment:

1. **Host App Handoff Format** (`DECISION_REQUIRED`): The exact token verification and identity exchange format between the host app and VDA. Mapped under the `HostIdentityContext` class.
2. **Clinician Queue Lease Duration** (`DECISION_REQUIRED`): The operational duration a clinician can lease an escalation task. Configured dynamically through `CLINICIAN_LEASE_TTL_SECONDS` in `.env`.
3. **Host Notification Channel APIs** (`DECISION_REQUIRED`): The endpoint format to send composed text notifications back to the host app for actual delivery.
4. **ABDM Production Credentials** (`DECISION_REQUIRED`): Gateway client IDs, client secrets, and signing keys for official ABHA registry integration.
