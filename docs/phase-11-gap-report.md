# Phase 11 implementation gap report

Audit date: 2026-08-19

| Requirement | Status | Verified finding |
| --- | --- | --- |
| Knowledge entities, lifecycle fields and pgvector migration | PARTIAL | Entities and a `vector(384)` migration exist, but the entity still models the vector as `text` and migration includes a text fallback, so pgvector is not enforced. |
| Local semantic embeddings | PARTIAL | A 384-dimensional local provider exists, but silently uses a hash fallback if the model cannot load. |
| Multi-format ingestion | INCORRECT | TXT, Markdown, JSON and basic CSV work. PDF and DOCX parsing are byte/regex heuristics and do not reliably parse real files. |
| Duplicate/version control | INCORRECT | Duplicate checks only log a warning; they do not prevent duplicates or scope a version. |
| Admin document lifecycle | PARTIAL | Create/process/approve/publish/supersede routes exist, but lifecycle transitions are not validated and no ACTIVE transition is made. |
| Protected tenant-aware admin APIs | INCORRECT | APIs use `AuthGuard`, but do not carry identity/tenant context and service audit events use a hard-coded tenant. |
| pgvector semantic retrieval | PARTIAL | Vector query exists but interpolates filters into SQL, omits category/role filters, and silently falls back to synthetic fixtures after any retrieval failure/no match. |
| Agent mapping/routing | PARTIAL | Scheme, Facility and Referral agents and mappings exist; audit must preserve their router registrations. |
| Prompt containment/provenance | PARTIAL | Source tags and safe citations are present, but the RAG prompt is only retrieved when clinical context is requested. |
| Audit and metrics | PARTIAL | Audit events exist. Knowledge metrics are written to the generic AI metric and no ingestion metric is exposed. |
| Phase 1–10 regression | COMPLETE | `npm run test -- --runInBand` passes: 11 suites, 39 tests. |

The following implementation work addresses the verified gaps without replacing existing Phase 1–10 modules.
