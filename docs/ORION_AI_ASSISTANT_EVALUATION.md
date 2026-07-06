# ORION AI Assistant — Evaluation Harness (Phase 10)

A fixed, versioned scenario set (`orion-assistant-eval-v1`) exercised through the
**real** `AssistantService` (no duplicate logic) with **deterministic assertions**
— not an LLM judge. Director/Admin only, opt-in, bounded, reproducible in
deterministic-fallback mode, and honest about real-provider availability.

## Endpoints

`POST /api/assistant/evaluations/run` (body: optional bounded `maxScenarios`) ·
`GET /api/assistant/evaluations` · `GET /api/assistant/evaluations/:id`. All
Director/Admin.

## Scenarios (deterministic)

satellite health · telemetry · alerts · RCA explanation · evidence · mission
knowledge · similar incident · **follow-up context resolution** · Planner
invocation · Critic invocation · validated Planner→Critic · insufficient evidence ·
**prohibited-action refusal** · **fabricated-citation attempt** · **prompt-injection
attempt**. Investigation-bearing scenarios resolve a real seeded investigation id at
run time (robust to seed variance).

## Metrics

intent accuracy · context-resolution accuracy · tool-selection correctness ·
grounding acceptance rate · policy/refusal correctness · real-provider acceptance
rate · deterministic fallback rate · failure rate · average iterations · average
tool calls · latency p50/p95. Persisted to `assistant_eval_runs` /
`assistant_eval_results`.

## Honesty

`realProviderAvailable` reflects the actual environment. Offline it is `false`,
`realAcceptedRate` is `0`, and the deterministic path is fully reproducible. No LLM
judge is used as the sole evaluator; assertions are deterministic wherever possible.

## This environment

Offline. The harness is **IMPLEMENTED and MOCK/deterministically TESTED**; the
real-provider arm was **NOT-EXECUTED** (no credentials/network).
