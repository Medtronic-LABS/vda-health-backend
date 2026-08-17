# ADR-006: Modular Monolith Architecture

## Context

We need to decide the architectural layout of the VDA backend, balancing development velocity, local deployment simplicity, and long-term service boundaries.

## Decision

1. Build VDA as a **Modular Monolith** rather than microservices.
2. Separate platform core directories (`src/auth`, `src/safety`, `src/ai`) from healthcare domain packs (`src/agents/adherence`, `src/agents/scheme`).
3. Business logic across agents must not run in separate containerized microservices. They run in the same NestJS application process but maintain clean dependency and folder separation.

## Status

Approved

## Consequences

- Faster development, simpler refactoring, and easier local docker-compose configuration.
- Service separation boundaries are clear, allowing future extraction of domain agents into microservices if scaling requirements demand it.
