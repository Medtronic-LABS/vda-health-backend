# ADR-003: Consent-Governed Conversation Persistence (Revised)

## Context

Conversations may contain sensitive clinical information. Patients have control over their data, governed by granular consent scopes.

## Decision

1. Raw conversation text (both user input and assistant output) is only persisted in the database if the active consent artifact contains the `conversation_retention` scope.
2. If this scope is missing or withdrawn, VDA will only persist turn metadata (such as timestamps, speaker, subject reference, intent classification, selected agent, latency, safety status, and consent version) and must discard the raw text.
3. This is evaluated synchronously during each turn execution.

## Status

Approved

## Consequences

- Turn logging mechanisms must conditionally serialize the text payload.
- Fully respects patient privacy regulations (e.g. DPDP Act) by default.
