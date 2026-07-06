# Real-Provider Architecture (Phase 9)

Phase 9 makes ORION genuinely capable of real-provider LLM generation and real
semantic embeddings, while preserving offline-first startup and deterministic
fallback. All real-provider functionality is **opt-in** via environment
configuration; with no credentials, ORION runs exactly as before
(`DETERMINISTIC_FALLBACK` LLM, `LOCAL_HASH_FALLBACK` embeddings).

## Execution paths (unchanged boundaries)

```
GroundedGeneration / Briefing / Copilot / Planner / Critic
        ↓ (only path)
     LlmRunner  ──→  LlmProvider (HttpLlmProvider adapter)  ──→ real endpoint
        ↓ fallback
     DeterministicFallbackProvider

Ingestion / Retrieval / Re-embedding
        ↓ (only abstraction)
   resolveEmbeddingProvider() ──→ EmbeddingProvider (HttpEmbeddingProvider) ──→ real endpoint
        ↓ default
     LocalHashEmbedding (LOCAL_HASH_FALLBACK)
```

- `LlmRunner` remains the ONLY application path to an LLM provider. No direct
  provider calls from briefing, generation, copilot, planner, critic, operational
  agents, APIs, or frontend. `LlmRunner` remains unwired from the six operational
  agents.
- `EmbeddingProvider` remains the ONLY embedding abstraction.
- Provider adapters (`HttpLlmProvider`, `HttpEmbeddingProvider`) normalize the
  OpenAI-compatible request/response into the existing contracts and normalize
  errors (AUTH / RATE_LIMIT / SERVER / TIMEOUT / BAD_RESPONSE). Retry + fallback
  are owned by `LlmRunner` and are not duplicated in adapters.

## New Phase 9 layer (`src/providers/`, `src/evaluation/`)

- **Capability model** (`types`, `providerCapabilities`) — explicit capabilities
  from configuration, never inferred from a provider name.
- **Validation** (`providerValidation`) + config helpers (`isTrustedEndpoint`,
  `isLlmProviderConfiguredSafely`, `isEmbeddingProviderConfiguredSafely`) —
  allowlist + HTTPS-for-non-loopback + completeness.
- **Registry** (`providerRegistry`) — derives the operating mode
  (OFFLINE / CONFIGURED / AVAILABLE / DEGRADED / UNAVAILABLE). A configured
  provider is never automatically AVAILABLE; AVAILABLE requires a fresh
  successful verification.
- **Health/verification** (`providerHealthService`) — bounded, opt-in,
  cooldown-guarded live checks (see PROVIDER_VERIFICATION.md).
- **Embedding-space identity + registry + re-embedding** (`embeddingSpace`,
  `embeddingSpaceService`) — see EMBEDDING_SPACE_MIGRATION.md.
- **Real-vs-fallback comparison** (`src/evaluation/providerComparison*`) — see
  REAL_VS_FALLBACK_EVALUATION.md.
- **Audit** (`providerRepository`) — append-only provider verification,
  embedding spaces, re-index, and comparison tables. No credentials, prompts,
  responses, vectors, or hidden reasoning.

## Security posture

API keys are read from the environment only; never hardcoded, never persisted,
never logged, never returned by any API, never sent to the frontend, never in
audits or docs. Endpoints are validated (absolute http(s); HTTPS required for
non-loopback). No arbitrary user-controlled endpoints/models/providers/prompts.
All provider management endpoints are Director/Admin only. Deterministic fallback
is never represented as real-provider output.

## Status vocabulary

IMPLEMENTED · MOCK-TESTED · LIVE-VERIFIED · NOT-EXECUTED · FAILED. In this
environment (no credentials / no network), the real-provider adapters, validation,
security, verification, re-embedding, comparison, observability, and frontend are
IMPLEMENTED and MOCK-TESTED; live verification is NOT-EXECUTED.

## Phase 10 — ORION AI Assistant consumption

The ORION AI Assistant consumes real-provider GenAI **only** through `LlmRunner`
(intent classification, conversation summarization, the dynamic tool-calling answer
loop) and real embeddings **only** through `EmbeddingProvider` + active-space
retrieval. A real answer that fails the quality gate is recorded `REAL_REJECTED` and
degraded to deterministic fallback — never counted as real-accepted. Offline, the
Assistant runs fully in deterministic fallback + LocalHash embeddings, honestly
labeled. Mock-provider tests are never reported as live verification.
