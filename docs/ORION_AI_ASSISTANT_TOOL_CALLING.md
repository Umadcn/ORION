# ORION AI Assistant — Dynamic Bounded Tool Calling (Phase 10)

The Assistant reuses the **frozen Phase 5 read-only tool executor** unchanged
(extended only with an optional resolver + tool-timeout injection, defaults
preserve exact Copilot behavior) and an assistant tool registry that **reuses the
8 Copilot tools and adds 4 new read-only tools**.

## Tool catalog

Reused (Phase 5): `getSatellite`, `getTelemetry`, `getAlerts`, `getInvestigation`,
`getEvidence`, `getReport`, `searchMissionKnowledge`, `searchHistoricalInvestigations`.

New (Phase 10, read-only): `resolveCitation`, `getKnowledgeDocumentMetadata`,
`getPlannerAnalysis`, `getCriticReview`.

The heavier read-only **workflows** — `runPlannerAnalysis`, `runCriticReview`,
`runValidatedInvestigationAnalysis` — are **not** generic tools; they are invoked
by the bounded `workflowService` with their own budgets and correlation linkage
(see the Planner/Critic workflow doc).

## Two execution paths (same grounding surface)

- **Deterministic (offline + fallback):** a capability-driven plan issues multiple
  sequential tool calls and Agentic RAG, folding results into the grounding
  context, then composes a grounded answer.
- **Real-provider (dynamic tool calling):** the model emits strict structured
  `TOOL_REQUEST` / `FINAL_ANSWER` steps (`ASSISTANT_STEP_SCHEMA`). Tool requests
  are constrained to the selected capability's allowlisted tools; folded into the
  **same** grounding + **same** budget counters.

## Every tool call is bounded, validated, audited

Fixed allowlist (unknown tools fail closed) · per-tool input/output JSON-schema
validation · RBAC · per-tool timeout + total execution timeout · max iterations ·
max tool calls · max retrieval calls · **duplicate tool-call detection** ·
capability-tool constraint (a tool not permitted for the capability is rejected,
not executed) · bounded + secret-redacted output · audited to
`copilot_tool_executions`. No mutation, no arbitrary function/API/SQL/URL/filesystem
access, no dynamic loading.

Example (`MISSION_QA`): `getSatellite → getInvestigation → getEvidence →
searchMissionKnowledge → searchHistoricalInvestigations → grounded answer`, all
within the capability's bounded budget.
