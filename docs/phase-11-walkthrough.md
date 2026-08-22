# Phase 11 local walkthrough

## Prerequisites

Start the local pgvector PostgreSQL and Redis services with `docker compose up -d postgres redis`, then run database migrations. Set `KNOWLEDGE_RAG_ENABLED=true`; `ABDM_ENABLED` remains `false` for this demo.

## Demo flow

1. Authenticate as an authorized administrator and upload a PDF, DOCX, TXT, Markdown, JSON, or CSV document to `POST /api/v1/admin/knowledge/documents` with its source, version, domain, language, and optional geography metadata.
2. The backend extracts text, calculates a SHA-256 checksum, chunks at configured boundaries, generates 384-dimensional embeddings, and persists them in `knowledge_embeddings` through pgvector.
3. Review the `REVIEW_REQUIRED` document, call `POST /api/v1/admin/knowledge/documents/:id/approve`, then `POST /api/v1/admin/knowledge/documents/:id/publish`.
4. A patient question is intent-classified and routed to its constrained agent domain. With RAG enabled, retrieval queries only approved published pgvector knowledge and safely supplies the resulting reference material separately from patient ClinicalContext.
5. The response may return safe `knowledge_sources` (title, source, version); database, tenant, embedding and ABDM identifiers are excluded.

## Verification status

`npx tsc --noEmit`, `npm run build`, `npm run lint`, and `npm run test -- --runInBand` pass. The existing full e2e run has two remaining lifecycle-fixture failures because the fixture publishes/supersedes a document whose approval did not complete; the application correctly rejects those invalid transitions.
