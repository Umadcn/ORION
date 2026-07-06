# Planner Agent Architecture (Phase 6)

A **bounded, READ-ONLY** Planner Agent that dynamically builds and executes an
investigation-analysis plan (Agentic RAG) over the existing read-only tools,
retrieval pipeline, LlmRunner, and grounding architecture.

## Non-negotiable truths

- **Analysis assistance only. Read-only.** The Planner never mutates
  investigations, RCA, evidence scores, alerts, telemetry, reports, or
  simulations; never approves/rejects/resolves; never controls satellites; never
  runs shell/SQL/filesystem/URL; never dynamically loads tools.
- **The deterministic RCA is authoritative** and preserved exactly.
- **LlmRunner only** for plan generation (no direct provider calls). `LlmRunner`
  remains unwired from the six operational agents.
- **Deterministic fallback is never labeled real.** Offline, a deterministic
  planner produces a bounded safe plan.
- **No Critic/Reflection agent, no self-critique, no long-term/semantic memory,
  no autonomous actions** — out of scope.
- **Grounding/retrieval scores are not confidence.**

## Modules

`src/planner/`: `types`, `schemas`, `prompt`, `plannerContext`, `actionRegistry`,
`planValidator`, `knowledgeGapDetector`, `retrievalQueryBuilder`,
`deterministicPlanner`, `planExecutor`, `analysisBuilder`, `plannerValidators`,
`plannerAuditRepository`, `plannerService`; `src/api/planner.ts`.

## Flow

```
investigation context (authoritative deterministic facts)
  → plan (LlmRunner real, OR deterministic planner)
  → schema + plan validation + safety gate  (invalid/unsafe → deterministic plan)
  → bounded, dependency-aware execution over the read-only action registry
      → INSPECT_* steps run Phase 5 Copilot tools (validated/timed/bounded/audited)
      → ASSESS_KNOWLEDGE_GAP → Agentic RAG (bounded iterative retrieval)
      → BUILD_FINAL_ANALYSIS (internal, deterministic)
  → deterministic grounded PlannerAnalysis
  → citation/evidence/grounding/policy validation
  → audit (planner_executions + step + refinement)
  → advisory result (ANALYSIS_ASSISTANCE_ONLY) → human review
```

## Plan schema (`orion-investigation-planner-v1`)

Strict object: `plan_version`, `objective`, `steps[]` (step_id, step_type,
reason, depends_on, parameters), `completion_criteria[]`. Step types are
allowlisted (10). `planValidator` enforces bounds, unique IDs, allowlisted types,
dependency validity + no forward/cycle deps, ID consistency (no fabrication), and
safety (no write/operational vocabulary, no SQL/URL/filesystem/paths, bounded
text/parameters). Fail-closed.

## Prompt / version

`orion-investigation-planner-v1`. The system prompt states the read-only role,
deterministic RCA + evidence authority, the allowlisted step types, prohibitions
(no RCA change, no decisions, no control, no invented IDs, no operational
commands), untrusted-document handling, and strict-schema output. Step `reason`
is a short bounded rationale — no hidden chain-of-thought.

## LlmRunner integration

Plan generation is one `LlmRunner.run<InvestigationPlan>` with the plan schema +
fallbackSeed (deterministic plan). Execution mode integrity, timeout, bounded
retries, token budget, LLM audit, correlation + investigation IDs, request type,
and prompt version are all preserved. A valid real plan → `REAL_PROVIDER`; an
invalid/unsafe real plan or unavailable provider → deterministic plan
(`DETERMINISTIC_FALLBACK`, `fallback_reason` recorded). No direct provider calls.

## Action registry

Fixed, frozen mapping from tool step types to the Phase 5 read-only Copilot tools
(`INSPECT_SATELLITE→getSatellite`, `INSPECT_TELEMETRY→getTelemetry`,
`INSPECT_ALERTS→getAlerts`, `INSPECT_INVESTIGATION→getInvestigation`,
`INSPECT_EVIDENCE→getEvidence`, `SEARCH_MISSION_KNOWLEDGE→searchMissionKnowledge`,
`SEARCH_HISTORICAL_INVESTIGATIONS→searchHistoricalInvestigations`,
`INSPECT_REPORT→getReport`). `ASSESS_KNOWLEDGE_GAP` and `BUILD_FINAL_ANALYSIS`
are internal deterministic operations. Mapped tools must exist in the frozen
Copilot allowlist (defense-in-depth). No duplicated business logic.

## Plan executor

Dependency-aware, deterministic-order execution reusing the Phase 5 tool executor
(input/output schema validation, per-tool timeout, output bounds, tool audit).
Bounds: max steps, max iterations, max tool calls, max retrieval calls, max
execution time, per-step timeout. Budget-exhausted / timeout / iteration limit
lead to graceful `PARTIAL` / `TIMED_OUT` / `ITERATION_LIMIT` completion. No
infinite loops. Step-level state is persisted.

## Final analysis

Deterministic `PlannerAnalysis` (title, objective, authoritative_root_cause,
analysis_summary, findings[], knowledge_gaps[], recommended_review_items[],
limitations[]). The authoritative root cause is copied exactly. Findings are
grounded via tool-facts, deterministic evidence, and resolvable mission-knowledge
citations, validated by the reused Phase 5 grounding/policy validators. No
operational commands, no decisions, no mutation, no invented IDs, no confidence.

## Human-in-the-loop boundary

Every result carries `advisoryLabel: ANALYSIS_ASSISTANCE_ONLY`. Planner output
cannot trigger approval/rejection/resolution/report/simulation/alert mutation or
satellite control. The API is read-only with respect to mission state.

## Audit

`planner_executions` (mode, plan status, step/iteration/tool/retrieval counts,
knowledge-gap count, linked LLM + retrieval execution IDs, citation/evidence
counts, grounding status, latency, fallback/failure reasons), `planner_step_executions`
(per step: type, order, status, tool, tool/retrieval execution ids, bounded
summaries), `planner_retrieval_refinements` (per RAG iteration). No raw prompts,
no hidden reasoning, no raw embeddings, no secrets, no unrestricted payloads.

## APIs

`POST /api/investigations/:id/planner-analysis` (read-only; any authenticated
role; body ignored — no prompt/plan/tools/provider/model/query overrides;
404 missing, 409 no-RCA). `GET /api/planner/executions[/:id]` (Director/Admin).

## Configuration

`ORION_PLANNER_MAX_STEPS`, `_MAX_ITERATIONS`, `_MAX_TOOL_CALLS`,
`_MAX_RETRIEVAL_CALLS`, `_MAX_QUERY_REFINEMENTS`, `_MAX_OUTPUT_CHARS`,
`_MAX_EXECUTION_MS`, `_STEP_TIMEOUT_MS`, `_MIN_CITATIONS`, `_MIN_EVIDENCE_ITEMS`.
Bounded, safe offline defaults.

## Limitations

Offline default always yields `DETERMINISTIC_FALLBACK` (real plan path is
mock-tested). The final analysis is deterministic (grounded summary, not
LLM-composed prose). Knowledge-gap detection + query refinement are deterministic
and lexical. No Critic/Reflection, no long-term memory, no autonomous actions.
