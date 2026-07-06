# ORION AI Assistant — Architecture (Phase 10)

The ORION AI Assistant is the **existing Phase 5 Mission Copilot upgraded** into a
complete, read-only, agentic conversational assistant. It does **not** duplicate
the Copilot: it reuses the conversation store, tool registry/executor, grounding
validators, deterministic fallback, `LlmRunner`, the Phase 9 provider/embedding
architecture + active embedding-space retrieval, and the Phase 6/7 Planner/Critic
services.

Legend: **IMPLEMENTED** = code exists & typechecks; **MOCK-TESTED** = exercised
with a mock provider; **LIVE-VERIFIED** = a genuine external provider call
succeeded; **NOT-EXECUTED** = not run in this environment.

## Turn pipeline

```
user message
  → bounded memory (retained window + optional summary)
  → intent routing (deterministic; real-provider structured classification optional)
  → context resolution (validated against authoritative data; fabricated/stale rejected)
  → capability selection (allowlisted, RBAC, fail-closed)
  → bounded execution: workflows (Planner/Critic/validated) + dynamic tool calling + Agentic RAG
  → grounded answer generation (real-provider bounded tool loop OR deterministic)
  → quality gate (context → schema → workflow refs → citations → evidence → grounding → policy → mode integrity)
  → persisted, audited AssistantExecutionResult (+ safe staged SSE stream)
```

## Modules (`backend/src/assistant/`)

| File | Responsibility |
|------|----------------|
| `types.ts` | Domain model (execution modes, intents, capability, answer, rich content, context, feedback, events). |
| `capabilities.ts` | Allowlisted capability catalog with per-capability tools/workflows/budgets/RBAC. Fail-closed. |
| `intentRouter.ts` | Deterministic router + optional real-provider structured classification (strict schema). |
| `contextResolution.ts` | Deterministic multi-turn reference resolution; validates every id; rejects fabricated/stale/out-of-range. |
| `memoryService.ts` | Bounded retained window + bounded summary (deterministic or optional real). Short-term only. |
| `assistantToolRegistry.ts` | Reuses the 8 Copilot tools + 4 new read-only tools. Fixed allowlist. |
| `tools/*` | `resolveCitation`, `getKnowledgeDocumentMetadata`, `getPlannerAnalysis`, `getCriticReview`. |
| `workflowService.ts` | Read-only chat invocation of Planner/Critic + validated Planner→Critic. Never duplicates their logic. |
| `deterministicAssistant.ts` | Capability executor: tools + Agentic RAG + workflows → grounding + rich content + deterministic answer. |
| `assistantValidators.ts` | The fixed quality gate (delegates grounding/policy to the Phase 5 validators). |
| `assistantService.ts` | Orchestrator: memory → routing → resolution → capability → execution → answer → gate → persist/audit. |
| `assistantEvaluation.ts` | Fixed versioned scenario harness with deterministic assertions. |
| `assistantRepository.ts` | Conversation state, executions, feedback persistence (bounded metadata only). |
| `sourceInspection.ts` | Exact citation/source inspection (no vectors/paths/secrets). |

Observability lives in `backend/src/observability/assistantMetrics.ts`; the API is
`backend/src/api/assistant.ts`; the frontend is `frontend/src/pages/AiAssistantPage.tsx`
+ `frontend/src/components/assistant/*`.

## Execution-mode integrity (non-negotiable)

Execution modes accurately represent runtime behavior:
`REAL_PROVIDER | DETERMINISTIC_FALLBACK | INSUFFICIENT_EVIDENCE | FAILED`. There is
no ambiguous `AI`/`SMART_AI`/`GENAI_SUCCESS`. A real-provider answer that fails the
quality gate is recorded `REAL_REJECTED` and **degraded to deterministic fallback**
— it is never counted as real-accepted. LocalHash embedding retrieval is never
labeled real semantic execution. Mock success is never live verification.

## Boundaries preserved from Phases 0–9

Advisory + read-only w.r.t. mission state; deterministic RCA/evidence/scoring remain
authoritative; `LlmRunner` is the only path to an LLM provider; `EmbeddingProvider`
is the only embedding abstraction; retrieval respects the active embedding space and
fails closed on mismatch; no autonomous actions, no satellite control, no
approve/reject/resolve, no write-capable tools, no arbitrary SQL/shell/URL, no
dynamic tool loading, no recursive agent spawning, no hidden chain-of-thought
stored/exposed, no secrets anywhere, offline-first startup, deterministic fallback,
no external vector DB, no long-term semantic memory.
