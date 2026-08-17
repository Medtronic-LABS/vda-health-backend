# ADR-007: Provider Abstraction for AI Services

## Context

The backend uses Sarvam AI for transcription (Saaras), text translation (Sarvam Translate), generation (Sarvam LLM), speech synthesis (Bulbul), and Gemini 3.5 for verification. Direct API coupling makes swapping models difficult.

## Decision

1. Core modules (agents, turns) must never import or call Sarvam or Gemini SDKs directly.
2. Abstract all operations behind standard gateway interfaces:
   - `STTProvider` (implemented by Sarvam Saaras)
   - `TranslationProvider` (implemented by Sarvam Translation)
   - `LLMProvider` (implemented by Sarvam LLM)
   - `TTSProvider` (implemented by Sarvam Bulbul)
   - `VerificationProvider` (implemented by Gemini 3.5)
3. Connect services through an `AIGateway` that resolves models dynamically from configuration.

## Status

Approved

## Consequences

- Easy model swapping (e.g. testing Claude, GPT or custom open source models) without modifying patient journeys or safety engines.
- Clear mocking capabilities for automated testing.
