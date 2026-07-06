# ORION AI Assistant — Planner / Critic / Validated Workflow (Phase 10)

Chat can invoke the **existing** Phase 6 Planner and Phase 7 Critic services via
`workflowService.ts`. It **never duplicates** their logic and **never mutates**
mission state; the deterministic RCA is preserved exactly.

## Planner from chat ("Run a deeper analysis of investigation N")

1. resolve the authoritative investigation (from message or active context),
2. require a completed deterministic RCA,
3. call `PlannerService.analyze` (read-only, bounded, its own Agentic RAG),
4. surface an advisory conversational explanation with citations/evidence + gaps,
5. label output `ANALYSIS_ASSISTANCE_ONLY`; **never** an autonomous decision.

## Critic from chat ("Critique that analysis")

1. resolve a valid Planner execution from conversation context,
2. call `CriticService.review`,
3. preserve `ACCEPT/REVISE/REJECT` as **analysis-quality review only** and
   `humanReviewRequired = true`,
4. explain decision, issues, contradictions, coverage, revisions, limitations.

Critic `ACCEPT` is **never** mapped to mission approval; `REJECT` is **never**
mapped to investigation rejection.

## Validated Planner → Critic ("Run a validated analysis")

`Planner → Critic (+ bounded revision loop inside CriticService) → validated
advisory analysis → grounded conversational answer → human review required.`
Correlation ids link Assistant → Planner → Critic → LLM → Retrieval. Bounded total
execution; failures are isolated and reported honestly (never faked); no recursive
agent spawning.

## Grounding + integrity

Planner citations/evidence and the analysis summary are folded into the grounding
surface so the conversational answer's claims are supported and resolvable. A
workflow that degrades to deterministic fallback is labeled `DETERMINISTIC_FALLBACK`
— never real. Answers reference workflow executions via `PLANNER:<id>` /
`CRITIC:<id>` refs, validated by the quality gate.
