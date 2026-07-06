# Real-vs-Fallback Evaluation (Phase 9)

A bounded, reproducible harness that compares `REAL_PROVIDER` vs
`DETERMINISTIC_FALLBACK` behavior over fixed, versioned ORION scenarios by
exercising the EXISTING application services through their existing `LlmRunner`
path — no duplicate application logic.

## Endpoint

`POST /api/providers/evaluations/compare` (Director/Admin, opt-in, cooldown-guarded).
Body accepts only an optional bounded `maxScenarios` — no arbitrary
prompts/providers/models/endpoints. `GET /api/providers/evaluations[/:id]` reads
runs + per-result rows.

## Method

- **Dataset**: `orion-provider-comparison-v1`. Scenarios are seeded investigations
  that have an authoritative RCA (deterministic, bounded by
  `ORION_PROVIDER_COMPARISON_MAX_SCENARIOS`).
- **Use-cases**: `PLANNER` and `CRITIC` — the newest real-provider consumers that
  self-assemble their context from an investigation id and produce full
  execution-mode + grounding signals. (Briefing and Copilot share the same
  `LlmRunner` seam and execution-mode semantics.)
- **Arms**: each use-case is run twice — a real arm (`realProviderAvailable=true`)
  and a deterministic-fallback arm (`realProviderAvailable=false`).

## Honesty guarantees

- A real-provider call that degrades to deterministic fallback is recorded as
  `fallbackOccurred` — **never** as real-accepted (`realAcceptedCount` counts only
  `executionMode === 'REAL_PROVIDER'`).
- A failed live run is preserved as `failed` — never replaced by a fallback
  success in the statistics.
- Offline (no real provider), `realAvailable=false`, the real arm degrades to
  fallback, `realAcceptedCount=0` — recorded truthfully.
- The deterministic-fallback arm is reproducible.

## Metrics

Per result (`provider_comparison_results`): arm, use-case, execution mode,
structured-output validity, grounding/citation/evidence/policy validity, fallback
occurred, failed, average grounding support (a ranking signal, NOT confidence),
latency, tokens (when the provider supplies them). Per run
(`provider_comparison_runs`): scenario count, real available, real accepted /
failed / fallback counts, real vs fallback grounding-valid rates, and average
latencies. Cost is not estimated (no trusted pricing configuration exists).

## Persistence

Append-only; only bounded metrics + references. No raw prompts, responses,
embeddings, secrets, or hidden reasoning.

## This environment

Offline. The comparison harness is IMPLEMENTED and MOCK/deterministically TESTED;
the real arm was NOT-EXECUTED against a live provider (no credentials/network).
