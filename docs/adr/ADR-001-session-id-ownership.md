# ADR-001: Session ID Ownership and Identification

## Context

The host Patient App integrates VDA as an embedded module. We need to map interactions to a session.

## Decision

1. The VDA backend generates and owns its internal `session_id` (a UUID).
2. The `external_id` provided by the host application represents the host's external user/subject identifier, NOT a VDA session ID.
3. Every session record in VDA maps this generated `session_id` to the subject's `external_id`.

## Status

Approved

## Consequences

- The VDA frontend must receive a generated VDA `session_id` on session creation and use it for subsequent turns.
- Clean separation between host user context and active session boundaries is preserved.
