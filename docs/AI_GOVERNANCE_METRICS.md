# AI Governance Metrics (Phase 8)

Deterministic, **advisory-only** governance rules over the observability metrics.
Each rule compares a computed metric against a bounded configuration threshold and,
if breached, emits a `GovernanceAlert`. Governance **never** mutates configuration,
mission state, agents, investigations, or provider selection — it only surfaces
review actions for a Director/Admin.

## GovernanceAlert shape

`alertId`, `severity` (INFO|WARNING|CRITICAL), `category`, `metric`,
`observedValue`, `threshold`, `comparison` (GREATER_THAN|LESS_THAN),
`description`, `recommendedReviewAction`, `timeRange`.

## Rules

| Rule | Metric | Default threshold | Severity | Guard |
|------|--------|-------------------|----------|-------|
| Excessive LLM fallback | `deterministicFallbackRate` | > 0.5 | WARNING | only when a real provider is configured (offline fallback is expected) |
| Excessive LLM failure | `failedRate` | > 0.2 | CRITICAL | llm total > 0 |
| Low structured-output validity | `structuredOutputValidRate` | < 0.8 | WARNING | structured requested > 0 |
| High grounding rejection | `1 − groundingValidRate` | > 0.5 | WARNING | generations > 0 |
| Low citation validity | `citationValidRate` | < 0.8 | WARNING | generations > 0 |
| Injection flags detected | `injectionFlagCount` | > 0 | WARNING | generations > 0 |
| High retrieval zero-result | `zeroResultRate` | > 0.5 | WARNING | retrievals > 0 |
| High Copilot tool error rate | tool `ERROR` / tool total | > 0.2 | WARNING | tool executions > 0 |
| High Planner partial/failure | `partial+timedOut+iterationLimit` | > 0.5 | WARNING | planner > 0 |
| High Critic contradiction | `averageContradictionCount` | > 1 | WARNING | critic > 0 |
| High revision-limit rate | `revisionLimitReachedRate` | > 0.5 | WARNING | critic > 0 |
| Audit linkage gaps | `orphanCriticCount` | > 0 | INFO | — |

Rules with an insufficient population (zero denominator) are skipped so a quiet
system raises no noise. The LLM-fallback rule fires only when a real provider is
configured; **offline deterministic operation raises no fallback alert**.

## Determinism + ordering

Given the same audit rows and thresholds, the alert set is identical. Alerts are
sorted CRITICAL → WARNING → INFO, then by `alertId`. `GovernanceStatus` carries
`advisory: true` and per-severity counts.

## Thresholds (bounded configuration)

`ORION_OBSERVABILITY_GOV_*` — each clamped to a safe range. Changing a threshold
changes only what is *surfaced*; it never changes system behavior. Governance is
observability, not control.

## Phase 9 provider governance rules (advisory)

| Rule | Metric | Severity | Guard |
|------|--------|----------|-------|
| Provider configured but never verified | `<kind>.operatingMode == CONFIGURED` | INFO | configured, no verification |
| Verification stale | `<kind>.verificationStale` | WARNING | prior success older than stale window |
| Provider unavailable | `<kind>.operatingMode == UNAVAILABLE` | WARNING | last verification failed |
| Embedding-space mismatch | `embeddingSpaceCount > 1` | WARNING | >1 space across chunks |
| Re-index failure | latest reindex `FAILED` | WARNING | — |
| Real available but heavy fallback | `realProviderExecutionRate < 0.5` | WARNING | LLM `AVAILABLE` |

Offline (both providers `OFFLINE`, single LocalHash space) none of these fire.

## What governance is NOT

It does not approve/reject/resolve investigations, does not change provider
selection or configuration, does not disable agents, and does not gate any
workflow. It is a read-only advisory lens for human reviewers.

## Phase 10 assistant governance rules (advisory)

| Rule | Metric | Severity | Guard |
|------|--------|----------|-------|
| Excessive assistant fallback | `assistant.deterministicFallbackRate` | WARNING | real provider configured + executions > 0 |
| Excessive assistant failure | `assistant.failureRate` | CRITICAL | executions > 0 |
| High insufficient-evidence | `assistant.insufficientEvidenceRate` | WARNING | executions > 0 |
| Low grounding-valid rate | `assistant.groundingValidRate` | WARNING | executions > 0 |
| High real-rejection rate | `assistant.realRejectionRate` | WARNING | real provider configured + executions > 0 |
| High negative feedback | `assistant.negativeFeedbackRate` | WARNING | feedback > 0 |

Offline (deterministic fallback, quiet system) none of these fire. All are advisory
only — no automatic configuration/model/provider/tool changes.
