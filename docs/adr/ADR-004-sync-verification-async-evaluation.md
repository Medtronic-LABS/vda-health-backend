# ADR-004: Synchronous Verification and Asynchronous Evaluation

## Context

AI-generated medical responses must be verified to prevent hallucinations and clinical errors, and evaluated against metrics like context recall and faithfulness (RAGAS).

## Decision

1. **Gemini 3.5 Verification**: Runs synchronously in the active turn pipeline. Generated responses must pass the independent verification check before being sent to the patient. If verification fails, the response is withheld.
2. **RAGAS Evaluation**: Runs asynchronously. Evaluating metrics such as context recall, context precision, and faithfulness is computationally expensive and must not block the patient response delivery.

## Status

Approved

## Consequences

- The turn request-response cycle stays fast.
- Post-turn event handlers or background workers compute evaluation metrics without increasing user latency.
