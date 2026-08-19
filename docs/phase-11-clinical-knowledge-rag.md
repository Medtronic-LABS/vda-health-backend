# Phase 11 — Production Knowledge Management, Local PostgreSQL + pgvector RAG & Agent Knowledge Platform

## 1. Overview & Architecture

Phase 11 extends the VDA Health Backend with a production-oriented Knowledge Management & RAG Platform using **PostgreSQL + `pgvector`** as the local vector store and a **Real Semantic Embedding Model (`all-MiniLM-L6-v2`)** producing dense 384-dimensional semantic vectors.

```
Document Upload (PDF/DOCX/TXT/MD/JSON/CSV)
      ↓
MultiFormatParserService (SHA-256 Checksum)
      ↓
DocumentChunkerService (1200-char sentence bounded)
      ↓
LocalSemanticEmbeddingProvider (all-MiniLM-L6-v2, 384-dim dense vectors)
      ↓
PostgreSQL + pgvector (knowledge_embeddings with HNSW Cosine Index)
      ↓
Cosine Similarity Search (<=> operator)
      ↓
KnowledgeRetrievalService (Min Relevance Score: 0.70)
      ↓
AgentKnowledgeMapper (Domain Scoping)
      ↓
Domain Agent (SchemeAgent, FacilityAgent, ReferralAgent, Clinical Agents)
      ↓
AI Orchestrator (Prompt Containment & Source Separation)
      ↓
Gemini LLM / Grounded Patient Response
```

---

## 2. PostgreSQL + pgvector Schema

### Tables & Extensions
- `vector` extension: `CREATE EXTENSION IF NOT EXISTS vector;`
- `knowledge_documents`:
  - Lifecycle Status: `UPLOADED` ➔ `PROCESSING` ➔ `REVIEW_REQUIRED` ➔ `APPROVED` ➔ `PUBLISHED` ➔ `ACTIVE` / `SUPERSEDED` / `FAILED`.
- `knowledge_chunks`: Sentence-bounded text chunks retaining parent metadata (`domain`, `category`, `language`, `state`, `district`).
- `knowledge_embeddings`:
  - `embedding`: PostgreSQL `vector(384)` column type.
  - `embeddingModel`: `all-MiniLM-L6-v2`
  - `embeddingDimension`: `384`
  - Index: `CREATE INDEX idx_embeddings_hnsw_cosine ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops);`

---

## 3. Real Semantic Local Embedding Provider

- **Provider**: `LocalSemanticEmbeddingProvider` (`KNOWLEDGE_EMBEDDING_PROVIDER=local`)
- **Runtime**: `@xenova/transformers` ONNX feature extraction pipeline (`Xenova/all-MiniLM-L6-v2`)
- **Dimension**: `384`
- **Normalization**: L2 Unit Normalization (`||v|| = 1.0`)
- **Similarity Operator**: Cosine Distance (`<=>`) in PostgreSQL `pgvector`.
- **Relevance Calculation**: `relevanceScore = 1 - cosineDistance` (Threshold: `0.70`).
- **Test Fallback**: `DevelopmentEmbeddingProvider` retained exclusively for isolated unit testing.

---

## 4. Multi-Domain Support & Agent Mappings

| Agent Name | Permitted Knowledge Domains | Default Target Domain |
|---|---|---|
| `MedicationAgent` | `medication`, `medication_education` | `medication` |
| `LabReportAgent` | `laboratory`, `diagnostic_education` | `laboratory` |
| `DiagnosisAgent` | `disease`, `clinical_guidelines` | `disease` |
| `GeneralHealthAgent` | `preventive_health`, `lifestyle`, `public_health` | `preventive_health` |
| `SchemeAgent` (NEW) | `government_schemes`, `ayushman_bharat` | `government_schemes` |
| `FacilityAgent` (NEW) | `healthcare_facilities`, `clinics`, `PHC`, `CHC`, `hospitals` | `healthcare_facilities` |
| `ReferralAgent` (NEW) | `referral_protocols`, `healthcare_facilities` | `referral_protocols` |

---

## 5. Security & Prompt Containment

Prompt context strictly demarcates patient data from general medical knowledge:

```
[SYSTEM INSTRUCTIONS]
...
[AUTHORIZED PATIENT CLINICAL CONTEXT]
...
[/AUTHORIZED PATIENT CLINICAL CONTEXT]

[AUTHORIZED GENERAL MEDICAL KNOWLEDGE]
[KNOWLEDGE SOURCE]
Title: PM-JAY Scheme Guide
Source: NHA Official (v1.0)
Domain: government_schemes
Content:
...
[/KNOWLEDGE SOURCE]
[/AUTHORIZED GENERAL MEDICAL KNOWLEDGE]

[CONVERSATION HISTORY]
...
[PATIENT QUERY]
...
```

Patient facts (e.g. `HbA1c = 7.2%`) come **ONLY** from `ClinicalContext`. General facts come **ONLY** from the Knowledge Base.

---

## 6. Admin REST APIs

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/admin/knowledge/documents` | Ingest multi-format file or DTO |
| `GET` | `/api/v1/admin/knowledge/documents` | List documents by domain/status |
| `GET` | `/api/v1/admin/knowledge/documents/:id` | Get document details and chunks |
| `PATCH` | `/api/v1/admin/knowledge/documents/:id` | Update document metadata |
| `DELETE` | `/api/v1/admin/knowledge/documents/:id` | Remove document |
| `POST` | `/api/v1/admin/knowledge/documents/:id/process` | Trigger chunking & embedding |
| `POST` | `/api/v1/admin/knowledge/documents/:id/approve` | Approve processed document |
| `POST` | `/api/v1/admin/knowledge/documents/:id/publish` | Publish document to vector store |
| `POST` | `/api/v1/admin/knowledge/documents/:id/supersede` | Mark document superseded |
| `POST` | `/api/v1/admin/knowledge/reindex` | Reindex all active documents |
| `GET` | `/api/v1/admin/knowledge/search` | Search vector index |

---

## 7. Verification & Tests

The 30-scenario test suite in `test/knowledge-rag.e2e-spec.ts` covers:
- Embedding dimensions (384) & L2 norm
- PDF, DOCX, TXT, MD, JSON, CSV parsing
- Sentence chunking
- Admin APIs & lifecycle approval
- Domain agent routing (`SchemeAgent`, `FacilityAgent`, `ReferralAgent`)
- Cosine similarity vector search
- Prompt injection containment
- Separation of patient clinical context vs general knowledge
- Hindi/Hinglish end-to-end turn processing
