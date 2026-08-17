# ADR-002: Host Identity and Token Exchange Abstraction

## Context

The host app passes authenticated patient context to VDA, including ABHA details. The exact token handoff and validation contract is not yet finalized.

## Decision

1. We will not finalize database schemas or columns specifically for persisting `subject_abha_ref` directly.
2. We introduce the `HostIdentityContext` abstraction interface. This interface validates incoming host requests, extracts subject attributes, and manages authorization scopes.
3. Actual persistence of ABDM credentials or profile links in VDA is deferred until the host-to-VDA token handoff format is officially defined.

## Status

Approved

## Consequences

- The application core is decoupled from the host's identity provider details.
- Integration can be completed later by implementing concrete versions of the `HostIdentityContext` interface without changing core business logic.
