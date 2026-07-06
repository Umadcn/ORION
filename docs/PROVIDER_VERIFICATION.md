# Provider Verification (Phase 9)

Explicit, opt-in, Director/Admin live health/conformance checks. NEVER run at
startup. Bounded, timeout-protected, cooldown-guarded, and audited. A configured
provider is NOT automatically AVAILABLE — AVAILABLE requires a fresh successful
verification.

## The load-bearing rule

**A live provider path is reported as verified ONLY when an actual configured
provider endpoint was reached and returned a valid response.** Deterministic
fallback can NEVER satisfy live verification. Mock-provider tests exist but a mock
success is never reported as live-provider verification.

## LLM verification — `POST /api/providers/llm/verify`

Uses `LlmRunner` (the only application path) with a fixed internal bounded
structured request and **fallback DISABLED**:

- `REAL_PROVIDER` + valid structured output → `REAL_PROVIDER_VERIFIED`
  (`liveProviderReached=true`, `structuredOutputValid=true`, `usageMetadataAvailable`).
- Reached but malformed structured output → `DEGRADED` (reached, not real-accepted).
- Not reached / auth / network / timeout → `UNAVAILABLE` (`liveProviderReached=false`).
- Not safely configured → `NOT_CONFIGURED`. Within cooldown → `COOLDOWN` (no call).

Because fallback is disabled, a failed real call yields `FAILED`→`UNAVAILABLE` —
it is never silently replaced by a deterministic result labeled real.

## Embedding verification — `POST /api/providers/embeddings/verify`

Calls the configured real `EmbeddingProvider` directly with a fixed input:

- genuine vector, correct dimension, finite → `REAL_EMBEDDING_VERIFIED`.
- reached but dimension/finiteness wrong → `DEGRADED`.
- network/auth failure → `UNAVAILABLE`. Not configured → `NOT_CONFIGURED`.
  Cooldown → `COOLDOWN`.

## Operating mode derivation (`providerRegistry`)

`OFFLINE` (not configured) · `CONFIGURED` (safe config, never verified) ·
`AVAILABLE` (fresh `*_VERIFIED`) · `DEGRADED` (last verification degraded) ·
`UNAVAILABLE` (last verification failed). A verified space older than
`ORION_PROVIDER_VERIFY_STALE_MS` reverts to `CONFIGURED` (stale) and raises an
advisory governance alert.

## Audit — `provider_verification_executions`

Append-only, bounded: correlation id, kind, provider, model, verification type,
status, `live_provider_reached`, latency, structured/dimension validity, usage
availability, normalized error code + sanitized message. **No** API keys, headers,
prompts, responses, or vectors. Read via `GET /api/providers/verifications`.

## Cooldown + rate limiting

`ORION_PROVIDER_VERIFY_COOLDOWN_MS` (default 15s) guards verification;
`ORION_PROVIDER_COMPARISON_COOLDOWN_MS` guards the comparison harness. Both return
`COOLDOWN`/429 rather than calling the provider again.

## This environment

No credentials / no network were available. Result:
`LIVE_LLM_VERIFICATION = NOT_EXECUTED`, `LIVE_EMBEDDING_VERIFICATION = NOT_EXECUTED`.
The verification code paths are IMPLEMENTED and MOCK-TESTED.
