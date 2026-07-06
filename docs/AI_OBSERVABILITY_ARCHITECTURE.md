# AI Observability Architecture (Phase 8)

A **read-only** AI Observability, Evaluation & Governance subsystem that aggregates
the EXISTING Phase 1–7 audit tables into strongly-typed metrics for a
Director/Admin dashboard. It is strictly read-only: it never mutates
configuration, mission state, agents, investigations, or provider selection, and
it introduces **no new event-logging pipeline** — the existing audit tables
remain the single source of truth.

## Non-negotiable truths

- **Read-only + advisory.** No writes, no autonomous actions, no provider
  changes. Governance alerts are advisory only.
- **Deterministic.** Given the same audit rows and reference time, metrics are
  identical. `now` is injected for reproducible tests.
- **Never mislabels.** Retrieval similarity, rerank scores, grounding support,
  coverage ratios, and evaluation metrics (Precision/Recall/MRR/nDCG) are
  ranking/quality signals — **never confidence**. Deterministic-fallback output
  is never represented as real model output.
- **No sensitive data.** Responses contain only bounded aggregates — never raw
  prompts, raw model responses, secrets, Authorization headers, raw vectors, or
  unrestricted payloads.
- **Offline-first.** With no real LLM/embedding provider, everything still works;
  the LLM operating mode is reported as `DETERMINISTIC_FALLBACK` and embeddings
  as `LOCAL_HASH_FALLBACK`.

## Modules

`src/observability/`: `types` (domain model), `aggregation` (pure percentile /
rate / distribution / time-range helpers), `observabilityRepository`
(parameterized SQL over an allowlisted set of audit tables), `metrics` (per-
subsystem + linkage builders), `governance` (deterministic advisory rules),
`observabilityService` (overview/snapshot/timeseries/evaluations/status).
`src/api/observability.ts` exposes the Director/Admin read-only routes.

## Data flow

```
range (24H|7D|30D|ALL) → repository fetch (parameterized, bounded, allowlisted table)
  → metric builders (pure aggregation: counts, rates, distributions, percentiles)
  → governance rules (deterministic thresholds → advisory alerts)
  → overview + snapshot + time-series + evaluation summary
  → Director/Admin read-only API → frontend AI Evaluation Dashboard
```

## Phase 9 extension — provider observability

The snapshot includes a `providers` block (`src/observability/providerMetrics.ts`):
LLM/embedding operating modes + last verification, real provider/embedding
execution rates, verification status distribution + latency, active embedding
space, embedding-space count + mismatch flag, latest re-index, and latest
real-vs-fallback comparison. Phase 9 governance alerts (provider configured but
never verified, verification stale, provider unavailable, embedding-space
mismatch, re-index failure, real-available-but-heavy-fallback) are merged into the
advisory governance status. Provider audit tables (`provider_verification_executions`,
`embedding_reindex_executions`, `provider_comparison_runs/_results`) are added to
the read-only aggregation allowlist. No credentials or raw payloads are exposed.

## Source tables (read-only)

`llm_executions`, `retrieval_executions`, `retrieval_evaluation_runs`,
`grounded_generation_executions`, `copilot_conversations`, `copilot_messages`,
`copilot_executions`, `copilot_tool_executions`, `planner_executions`,
`planner_step_executions`, `planner_retrieval_refinements`, `critic_executions`,
`critic_issues`, `critic_revision_attempts`. Table names come from a fixed
internal allowlist; there is no arbitrary table/column selection and no arbitrary
SQL. Row fetches are bounded by `ORION_OBSERVABILITY_MAX_ROWS`; `COUNT(*)` is
exact within range.

## Time ranges

`24H` / `7D` / `30D` use an ISO-8601 UTC `created_at >= cutoff` predicate
(chronologically correct via lexical compare); `ALL` applies no lower bound.

## Percentiles

Nearest-rank method on ascending-sorted `latency_ms` samples: `rank =
ceil(p/100 · n)`, value = `samples[rank−1]`. Exact, deterministic, unit-tested
(p50/p95/p99, empty set → null, single sample).

## End-to-end linkage

Correlation-aware metrics are computed **only** from explicit correlation IDs or
persisted link fields (`planner_executions.llm_execution_ids_json` /
`retrieval_execution_ids_json`, `critic_executions.planner_execution_id` /
`llm_execution_ids_json`). Links are never inferred heuristically. Orphan audit
rows and deterministic-only plans are surfaced explicitly.

## APIs

All under `/api/observability`, Director/Admin only, read-only:
`GET /status`, `/overview`, `/llm`, `/retrieval`, `/generation`, `/copilot`,
`/planner`, `/critic`, `/governance`, `/evaluations`, `/snapshot`, and
`/timeseries?metric=<allowlisted>&range=`. `range` is allowlisted (invalid →
configured default); `metric` is allowlisted (invalid/missing → 400).

## Configuration

`ORION_OBSERVABILITY_DEFAULT_RANGE`, `_MAX_RANGE_DAYS`, `_MAX_ROWS`,
`_TIMESERIES_BUCKET_LIMIT`, `_MAX_DISTRIBUTION_ITEMS`, `_MAX_EVALUATION_HISTORY`,
and `_GOV_*` governance thresholds. Bounded, safe offline defaults; sanitized
status via `describeObservabilityConfig`.

## Limitations

Aggregation is over the most recent `MAX_ROWS` rows within range (bounded;
exact for the offline dataset). Repeated-review loop stops are not individually
persisted, so `repeatedReviewStopCount` is 0 unless a future schema records it.
Metrics are descriptive, not predictive; governance thresholds are heuristics.

## Phase 10 extension — assistant observability

The snapshot includes an `assistant` block (`src/observability/assistantMetrics.ts`):
conversation/message counts, execution-mode distribution, real-accepted /
deterministic-fallback / insufficient / failure / refusal rates, intent + capability
distributions, context-resolution success, average iterations/tool/retrieval calls,
Planner/Critic/validated invocation counts, grounding-valid rate, average grounding
support (a ranking signal, NOT confidence), quality-gate distribution, latency
p50/p95/p99, feedback counts + positive rate + reason distribution, and real-
rejection rate. Assistant governance alerts are merged into the advisory status. The
assistant audit tables are added to the read-only aggregation allowlist. No prompts,
raw responses, hidden reasoning, raw vectors, or secrets are exposed.
