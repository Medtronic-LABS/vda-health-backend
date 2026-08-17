# ADR-005: Configurable Clinician Queue Lease

## Context

When a turn triggers a safety or quality escalation, it enters a clinician review queue. Multiple clinicians should not claim and work on the same case simultaneously.

## Decision

1. The duration a clinician can lease a task from the queue will not be hardcoded (e.g. 5 minutes).
2. The duration is defined in configuration (`CLINICIAN_LEASE_TTL_SECONDS` environment variable).
3. The value is marked as `DECISION_REQUIRED` pending final alignment with clinical ops.

## Status

Approved

## Consequences

- Operation teams can adjust clinical queue responsiveness without code changes.
- Redis locks or TTL indexes will be used to enforce lease expiration.
