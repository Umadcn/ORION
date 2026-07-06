# PROJECT ORION — GenAI Implementation Plan

How the 14-phase GenAI/Agentic target maps onto ORION's **offline-first Node/TypeScript + SQLite** stack, preserving the deterministic core.

## Guiding principles (derived from the rules)

1. **Deterministic core stays authoritative.** LLMs generate hypotheses, explanations, recommendations, narrative, and copilot answers. Thresholds, anomaly detection, evidence scoring, confidence math, mission-policy enforcement, and human approval remain deterministic code (rule 4).
2. **Offline-first with a real provider seam.** A provider-independent LLM abstraction supports real providers (OpenAI-compatible / Anthropic) via env vars, but **defaults to an explicit, labeled deterministic fallback provider** so the whole platform works with no network/keys — exactly mirroring the existing `OFFLINE_FIXTURE` pattern. Execution mode is recorded on every LLM audit record; fallback output is never presented as model output (rule 14).
3. **Everything grounded + audited.** Every LLM factual claim carries `evidence_id`/`citation_id` references validated against real evidence and retrieved chunks; unsupported references are rejected (rules 7, 8).
4. **No new heavy infrastructure.** Vector store, embeddings, BM25, reranking, and semantic cache are implemented **in-process over SQLite + JS** (no Qdrant/pgvector/Python) to respect the company-laptop constraint. Abstractions allow swapping in a hosted store later.
5. **Bounded agent loops.** Max iterations, timeouts, token budgets, loop detection, graceful failure on every agent/planner/RAG loop (rule 9).
6. **Read-only first.** Copilot + all tools are read-only; consequential actions keep human-in-the-loop (rules 10, 11).

## Technology choices for this stack

| Capability | Choice | Rationale |
|---|---|---|
| LLM provider | `LlmProvider` interface; `DeterministicFallbackProvider` (default) + optional `HttpLlmProvider` (OpenAI/Anthropic-compatible, env-gated, uses global `fetch`) | No new deps; offline default; real path when configured |
| Structured output | JSON Schema validated by a small hand-rolled validator (or `zod` only if approved) | Avoid heavy deps; runtime validation + retry-on-invalid |
| Embeddings | `EmbeddingProvider` interface; default `LocalHashEmbedding` (deterministic TF-token hashed vector) + optional HTTP embedder | Offline, reproducible, swappable |
| Vector store | SQLite table of chunk vectors + JS cosine similarity | No native/vector-db install |
| Keyword retrieval | In-JS BM25-lite over chunk tokens | Hybrid fusion partner |
| LLM/retrieval audit | New SQLite tables | Observability + evaluation |
| Semantic cache | SQLite table keyed by (model, prompt-version, auth-context, embedding-bucket) + TTL | Rule 12 |

## Phase → files (extend, don't rewrite)

- **P1 LLM foundation**: `src/llm/` (provider interface, fallback + http providers, schema validate, runner with timeout/retry/budget), `llm_executions` table, `api/llm.ts` (admin/debug), tests.
- **P2 Knowledge base + vectors**: `src/knowledge/` (parse/chunk/embed/store), tables `documents`, `doc_chunks`; `api/knowledge.ts` (RBAC-gated ingest); seed offline mission docs.
- **P3 Hybrid retrieval**: `src/retrieval/` (vector + BM25 + fusion + rerank + audit), `retrieval_logs` table, eval fixtures.
- **P4 LLM investigation agents**: `src/agents/llm/` wrapping existing agents; extend `evidence`/`citations`; **scoring untouched**; persist executions.
- **P5 Planner + runtime**: `src/planner/` action registry + bounded runtime; integrate as an *optional* path in the orchestrator (deterministic sequential path remains default/fallback).
- **P6 Agentic RAG**: gap detection + bounded iterative retrieval; persist queries/chunks/scores.
- **P7 Critic/reflection**: `src/agents/llm/criticAgent.ts` + bounded revise loop; persist critiques.
- **P8 Mission Copilot**: `src/copilot/` read-only tool registry + tool-calling loop + RBAC + sanitization + conversation audit; upgrade `AiDrawer.tsx`.
- **P9 Memory**: session + summarization + resolved-incident semantic recall; never overrides live telemetry/evidence.
- **P10 Guardrails**: prompt-injection scan, allowlists, arg/schema/evidence/citation/satellite-ID/policy validation, secret filtering, thresholds, escalation, circuit breaker; adversarial tests.
- **P11 Observability + eval dashboard**: metrics tables + `api/evaluation.ts` + frontend AI Evaluation page.
- **P12 Semantic cache**: read-only LLM/retrieval cache with security-context-aware keys.
- **P13 Multimodal**: gated image/plot ingestion + vision abstraction + structured findings + human review.

## Regression gate (after every phase — rule 12)

`backend: tsc + vitest` · `frontend: tsc + vitest + build` · API regression (auth, RBAC 401/403, dashboard/satellites/telemetry/alerts) · **full director investigation workflow** (reset → inject → 6-agent investigation → RCA → approve → resolve → report). Any regression is fixed before proceeding (rule 13).

## Technical risks

1. **No LLM available offline** → default deterministic-fallback mode; real-model path is code-complete but only exercised when a provider+key are configured (documented, not faked).
2. **`node:sqlite` experimental** → already mitigated with a typed facade + tests; new tables follow the same pattern.
3. **In-process vector search scale** → fine for a demo corpus; abstraction allows swap-out.
4. **Token/latency budgets** → enforced in the runner; fallback is instant.
5. **Frontend bundle size** (already >500 KB advisory) → new AI pages may warrant lazy-loading (Phase 11).
6. **Grounding correctness** → strict evidence/citation validators + critic (Phases 4, 7, 10).
