# Clinical escalation human-in-the-loop workflow

The patient turn pipeline evaluates the original input with the existing SafetyGate before PII redaction. The original input is not logged or persisted by the turns or escalation path. PII sanitization then governs all persisted/downstream text.

When an existing `ESCALATION_REQUIRED` rule fires, the service creates an operational record in `clinical_escalations`, audits its creation, and returns the existing immediate patient safety response. The path does not call Gemini or RAG. Existing `HIGH` rules are recorded as T1. The persistence model supports T2 for a future existing non-high escalation rule, but no T2 clinical rule is defined by this implementation.

`WITHHOLD`, ordinary safe turns, and future T3/T4 mechanisms do not create a clinical escalation record. The queue is separate from response-review and RAG evaluation data.

The administrative API is tenant-scoped under `/api/v1/admin/escalations`. Development access uses the existing development-auth boundary. Outside development, the host identity must contain `clinical_escalation_review` or `admin` scope. This workflow records review outcomes and annotations; it sends no clinician/patient notifications and does not claim a clinician was paged.

Only a HMAC subject reference, existing rule metadata, safe patient message, and sanitized input where existing conversation-retention policy allows are retained. Reviewer notes are operational data and must not contain raw PII.
# Response-review controls

The Clinical Escalations queue provides a separate operational response review after a SafetyGate escalation is persisted. Reviewers may approve the original response, save a corrected response while retaining the original, or add an annotation without changing either response. These decisions are separately audited as `clinical_response_approved`, `clinical_response_corrected`, and `clinical_response_annotated`.

Corrections are retained for operational review only. Patient notification or delivery of a correction is not configured.

# Draft red-flag source status

`vda-clinical-red-flag-spec-v0.1-DRAFT.docx` and `vda-red-flags-v0.1-DRAFT_1.json` were reviewed as development drafts. Their proposed rules are labelled `DRAFT_AI_UNAPPROVED`; they are not enabled or deployed. The approved SafetyGate rule set remains authoritative.
