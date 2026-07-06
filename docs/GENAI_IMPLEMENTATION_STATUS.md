# PROJECT ORION — GenAI Implementation Status (Journal)

Living log of completed work, decisions, migrations, APIs, tests, limitations, and the exact next step.

---

## Phase 0 — Repository Baseline & Architecture Discovery — ✅ COMPLETE

**Completed**
- Inspected the full repository (49 backend src files, 5 backend test suites, 44 frontend src files, 1 frontend test suite).
- Documented actual architecture → `docs/GENAI_ARCHITECTURE_BASELINE.md`.
- Documented phased plan mapped to this stack → `docs/GENAI_IMPLEMENTATION_PLAN.md`.
- Ran full baseline verification.

**Baseline results (verified)**
- Backend typecheck: 0 errors. Backend tests: **38/38 pass**.
- Frontend typecheck: 0 errors. Frontend tests: **11/11 pass**. Frontend build: ✅.

**Architecture decisions**
- LLM layer built *around* the deterministic core; scoring/thresholds/policy/approval stay deterministic.
- Provider-independent LLM abstraction with a **default deterministic-fallback provider** (offline-first), real HTTP provider env-gated.
- Vectors/BM25/rerank/semantic-cache implemented **in-process over SQLite + JS** (no new infra).
- Grounding enforced via evidence/citation ID validation; read-only copilot; human-in-the-loop preserved.

**Migrations**: none yet (Phase 0 is inspection only).
**APIs added**: none yet.
**Known limitations**: no LLM/model or network available on this laptop → the GenAI layer will run in labeled deterministic-fallback mode by default; the real-provider code path is exercised only when `ORION_LLM_*` env vars are configured.

**Regressions**: none. Baseline clean.

---

## Phase 1 — LLM Foundation — ✅ COMPLETE

**Files added (backend)**
- `src/llm/types.ts` — contracts (`LlmMessage/Role/Request/Response/Usage/Error`, `LlmExecutionMode` = REAL_PROVIDER | DETERMINISTIC_FALLBACK | FAILED, status, finish reason, `StructuredOutputSchema`, `StructuredValidationResult`, `ProviderCapabilities`, `RawCompletion`).
- `src/llm/schema.ts` — dependency-free JSON-Schema validator + `parseAndValidate` (malformed-JSON safe).
- `src/llm/provider.ts` — `LlmProvider` interface, `ProviderError` (code + retryable), token estimators.
- `src/llm/deterministicProvider.ts` — `DeterministicFallbackProvider` + `synthesizeFromSchema` (shapes schema-valid output from grounding seed; never fabricates; clearly labeled).
- `src/llm/httpProvider.ts` — optional OpenAI-compatible `HttpLlmProvider` (env-gated, injectable fetch, AbortSignal, normalized errors, no logged secrets) + `buildRealProvider()`.
- `src/llm/runner.ts` — `LlmRunner` (config→provider→input budget→timeout→structured validation→bounded-backoff retries→fallback→audit→normalized response) + `computeBackoff` + shared `llmRunner`.
- `src/services/llmAuditService.ts` — create/get/list (filters + bounded pagination).
- `src/api/llm.ts` — read-only RBAC-gated router.
- `tests/llm.test.ts` (25) + `tests/llmApi.test.ts` (8).

**Files modified**: `src/config.ts` (+`llm` config, `isRealLlmConfigured`, `describeLlmConfig`, `redactSecrets`); `src/db.ts` (+`llm_executions` table + indexes); `src/app.ts` (mount `/api/llm`); `.env.example` (ORION_LLM_* documented, no creds).

**Database**: new `llm_executions` table (correlation_id, investigation_id?, agent_execution_id?, provider, model, execution_mode, execution_status, prompt_version, request_type, token counts, latency_ms, retry_count, structured_output_requested/valid, validation_errors, fallback_reason, error_code, sanitized_error_message, opt-in request/response summaries, created_at) + indexes on correlation_id, investigation_id, mode, status, created_at. **No secrets stored; raw payloads only opt-in + sanitized.**

**Config vars**: `ORION_LLM_PROVIDER` (default `none`), `ORION_LLM_ENDPOINT`, `ORION_LLM_API_KEY`, `ORION_LLM_MODEL`, `ORION_LLM_TIMEOUT_MS`, `ORION_LLM_MAX_RETRIES`, `ORION_LLM_MAX_INPUT_TOKENS`, `ORION_LLM_MAX_OUTPUT_TOKENS`, `ORION_LLM_FALLBACK_ENABLED`.

**Provider architecture**: application → `LlmRunner` → `LlmProvider` (real HTTP if configured, else deterministic fallback). Mode assigned solely by the runner; fallback output can never be labeled REAL_PROVIDER.

**Policies**: retries only on retryable errors (429/5xx/network/timeout), bounded exponential backoff (capped), configurable timeout via AbortController, input token-budget enforcement, structured-output validation (non-retryable), deterministic fallback when enabled else FAILED. Every execution persisted.

**APIs**: `GET /api/llm/status`, `GET /api/llm/executions`, `GET /api/llm/executions/:id` (Director + Admin only, read-only, sanitized).

**Tests added**: 33 (25 unit + 8 API), covering all 27 required behaviors. **Regression: backend 71/71, frontend 11/11, both typecheck, frontend build ✅; runtime auth/RBAC + full director investigation workflow verified; no secrets in logs/responses/DB/docs.**

**Known limitations**: no model/network on this laptop → default operating mode is DETERMINISTIC_FALLBACK; the real-provider path is code-complete + unit-tested with mocks but only exercised live when `ORION_LLM_*` is configured. The runner is not yet wired into any agent (that is Phase 4), so `llm_executions` is empty at runtime by design.

---

## Phase 2 — Mission Knowledge Base, Embeddings, Vector Retrieval — ✅ COMPLETE

**Architecture**: offline-first ingestion → normalization → deterministic chunking → embedding (default `LocalHashEmbedding`, `LOCAL_HASH_FALLBACK`) → SQLite vector store → bounded cosine retrieval → stable citations + provenance → retrieval audit. Deterministic core, six agents, orchestrator, investigation lifecycle, approvals, reports, auth/RBAC, and the LLM foundation are all **unchanged**. The `LlmRunner` is **not** wired into agents (that remains Phase 4).

**Files added (backend)**
- `src/knowledge/types.ts` — domain contracts (document/chunk/citation/retrieval + `EmbeddingExecutionMode`/`RetrievalExecutionMode`).
- `src/knowledge/normalize.ts` — deterministic normalization + SHA-256 content hashing.
- `src/knowledge/chunk.ts` — paragraph-aware, bounded, loop-safe chunking + config resolver.
- `src/knowledge/citations.ts` — stable `ORION-KB-<ID>-C<0000>` citation IDs (build/parse/validate).
- `src/knowledge/repository.ts` — `KnowledgeDocumentRepository`, `KnowledgeChunkRepository`, `RetrievalAuditRepository` (bounded).
- `src/knowledge/vectorStore.ts` — `VectorStore` interface + `SQLiteVectorStore` (cosine, deterministic tie-break, dimension/finiteness validation).
- `src/knowledge/ingestionService.ts` — safe, idempotent, transactional ingestion (plain text only; no paths/URLs fetched).
- `src/knowledge/retrievalService.ts` — full retrieval flow + citation resolution + audit.
- `src/knowledge/seed.ts` — 8 original synthetic ORION documents (`SYNTHETIC_ORION_CORPUS`), idempotent offline seed.
- `src/embeddings/provider.ts` — `EmbeddingProvider` interface, `EmbeddingError`, cosine/L2/finite helpers.
- `src/embeddings/localHashEmbedding.ts` — deterministic lexical feature hashing (always `LOCAL_HASH_FALLBACK`; **not** a neural model).
- `src/embeddings/httpEmbeddingProvider.ts` — optional env-gated real embedding seam (AbortController, batch bound, no hardcoded creds).
- `src/embeddings/index.ts` — provider selection (`resolveEmbeddingProvider`).
- `src/api/knowledge.ts` — RBAC-gated knowledge API.
- `tests/knowledge.test.ts` (32) + `tests/knowledgeApi.test.ts` (15).
- `docs/KNOWLEDGE_RETRIEVAL_ARCHITECTURE.md`.

**Files modified**: `src/config.ts` (+`embedding`/`knowledge`/`retrieval` blocks, `clampInt`, `isRealEmbeddingConfigured`, `describeEmbeddingConfig`, `describeKnowledgeConfig`, embedding key added to `redactSecrets`); `src/db.ts` (+3 tables + indexes); `src/app.ts` (mount `/api/knowledge` + `seedKnowledgeIfEmpty` in `initOrion`); `src/api/errors.ts` (map ingestion/retrieval validation → 400); `.env.example` (ORION_EMBEDDING_*/KNOWLEDGE_*/RETRIEVAL_*, no creds).

**Database**: `knowledge_documents` (stable id UNIQUE, hash, normalized content, status, provenance, metadata) + `knowledge_chunks` (stable id + citation id UNIQUE, offsets, metadata JSON, embedding provider/model/mode/version/dimension/vector) + `retrieval_executions` (correlation id, query hash, sanitized summary, mode, counts, latency, status). Indexes added. **No secrets, no Authorization headers stored.**

**Config vars**: `ORION_EMBEDDING_PROVIDER` (default `local`), `_ENDPOINT`, `_API_KEY`, `_MODEL`, `_DIMENSION` (256), `_TIMEOUT_MS`, `_MAX_BATCH_SIZE`; `ORION_KNOWLEDGE_MAX_DOCUMENT_CHARS` (100000), `_MAX_BATCH_DOCUMENTS` (25), `_CHUNK_SIZE` (1200), `_CHUNK_OVERLAP` (150); `ORION_RETRIEVAL_DEFAULT_TOP_K` (5), `_MAX_TOP_K` (25), `_MAX_CANDIDATES` (5000), `_MAX_QUERY_CHARS` (2000). Safe offline defaults; startup unchanged when unset.

**APIs** (all authenticated; mounted after `authenticate`): `GET /status` (ops), `POST /documents` (ops), `POST /documents/batch` (ops), `GET /documents`, `GET /documents/:id`, `GET /documents/:id/chunks`, `GET /citations/:citationId`, `POST /search`, `GET /retrieval-executions` (ops), `GET /retrieval-executions/:id` (ops). "ops" = Mission Director + System Admin; read/search = any authenticated role. No arbitrary-prompt, no filesystem-path, no URL-fetch endpoints.

**Regression results (verified this session)**
- Backend typecheck ✅ · Backend tests **118/118** (was 71; +32 knowledge, +15 knowledgeApi).
- Frontend typecheck ✅ · Frontend tests **11/11** · Frontend production build ✅.
- Runtime smoke (fresh instance, offline): `/api/knowledge/status` → `LOCAL_HASH_FALLBACK`, 8 docs / 12 chunks, no secret leak; analyst→403; search (`VECTOR_COSINE`, `LOCAL_HASH_FALLBACK`) top-1 = `ORION-3-PAYLOAD-POWER-INCIDENT`; citation resolves with `SYNTHETIC_ORION_CORPUS` provenance; subsystem filter correct; retrieval audit persisted + sanitized; analyst→403 on audit; **LLM status still `DETERMINISTIC_FALLBACK`/none** (Phase 1 intact); no secrets in server log.

**Known limitations**: LocalHashEmbedding is lexical (not semantic) — good enough for the demo corpus; a real embedding provider is a configured seam, not exercised live here. The seeded corpus is embedded offline with LocalHashEmbedding; switching to a real provider requires re-ingestion so vectors share one space. SQLite linear cosine scan is bounded and replaceable. No RAG answer generation / reranking / copilot (out of Phase 2 scope, by design).

---

## Phase 3 — Hybrid Retrieval, BM25, RRF, Deterministic Reranking, Evaluation — ✅ COMPLETE

**Architecture**: retrieval upgraded from vector-only to an offline-first hybrid pipeline with four modes — `VECTOR` (default, = Phase 2, audited as `VECTOR_COSINE`), `LEXICAL_BM25` (no embedding generated), `HYBRID_RRF` (vector + BM25 fused via Reciprocal Rank Fusion), `HYBRID_RRF_RERANK` (+ deterministic reranker). Plus a retrieval-quality evaluation harness. Deterministic core, six agents, orchestrator, lifecycle, approvals, reports, auth/RBAC, LLM foundation, and Phase 2 knowledge/embeddings/citations are all **unchanged**. `LlmRunner` remains **unwired** from agents. No RAG answers, no copilot.

**Files added (backend)**: `src/retrieval/{types,tokenize,bm25,fusion,reranker,metrics,evaluationDataset,evaluationService}.ts`; `tests/{retrieval,retrievalEval,knowledgeHybridApi}.test.ts`. Docs: `docs/HYBRID_RETRIEVAL_ARCHITECTURE.md`, `docs/RETRIEVAL_EVALUATION.md`.

**Files modified**: `src/knowledge/types.ts` (RetrievalMode + diagnostics + score-breakdown + extended result item/result/query + execution modes), `src/knowledge/retrievalService.ts` (mode-aware pipeline + diagnostics + expanded audit; VECTOR path byte-for-byte backward compatible), `src/knowledge/repository.ts` (expanded retrieval audit + `RetrievalEvaluationRepository`), `src/api/knowledge.ts` (search `mode` + evaluation endpoints + status enrichment), `src/config.ts` (+`clampFloat`, mode/bm25/fusion/rerank/eval config, exposed in `describeKnowledgeConfig`), `src/db.ts` (expanded `retrieval_executions` + `retrieval_evaluation_runs` + idempotent column migration), `.env.example`.

**Database**: `retrieval_executions` extended with `vector_candidate_count`, `bm25_candidate_count`, `fused_candidate_count`, `reranked_candidate_count`, `fusion_k`, `reranker_version`, `evaluation_run_id` (nullable; older rows readable; `addColumnIfMissing` migration for pre-Phase-3 files). New `retrieval_evaluation_runs` table (mode, config snapshot, the five metrics, latency, status). No secrets, no embeddings stored.

**Config vars**: `ORION_RETRIEVAL_DEFAULT_MODE` (VECTOR), `_VECTOR_CANDIDATES` (50), `_BM25_CANDIDATES` (50), `_FUSION_K` (60), `_RERANK_CANDIDATES` (50), `_BM25_K1` (1.2), `_BM25_B` (0.75), `_MAX_QUERY_TOKENS` (64), `_EVAL_MAX_QUERIES` (50). Bounds-validated; offline defaults; startup unaffected when unset.

**APIs**: `POST /api/knowledge/search` now accepts `mode` (backward compatible); `POST /api/knowledge/evaluations/run` (Director/Admin; `ALL` or a single mode), `GET /api/knowledge/evaluations`, `GET /api/knowledge/evaluations/:id` (Director/Admin).

**Measured evaluation (K=5, 8 queries, LocalHashEmbedding dim 256, fusion k=60)** — actual values:
| Mode | P@5 | R@5 | MRR | Hit@5 | nDCG@5 |
|------|----|----|----|----|----|
| VECTOR | 0.200 | 1.000 | 1.000 | 1.000 | 0.964 |
| LEXICAL_BM25 | 0.200 | 1.000 | 1.000 | 1.000 | 0.964 |
| HYBRID_RRF | 0.200 | 1.000 | 1.000 | 1.000 | 0.964 |
| HYBRID_RRF_RERANK | 0.200 | 1.000 | 1.000 | 1.000 | **1.000** |
On this small corpus every mode already ranks a relevant doc at #1 (R/MRR/Hit saturate); the only measured differentiation is nDCG@5, where the reranker improves graded ordering 0.964→1.000. **Hybrid is not claimed to beat vector here** — the numbers are reported as measured.

**Regression results (verified this session)**
- Backend typecheck ✅ · Backend tests **164/164** (was 118; +26 retrieval, +10 evaluation, +10 hybrid API).
- Frontend typecheck ✅ · Frontend tests **11/11** · Frontend production build ✅.
- Runtime smoke (fresh offline instance): documented below in Phase 3 report.

**Known limitations**: LocalHashEmbedding is lexical (not semantic); metrics saturate on the tiny corpus (limited discrimination between modes). BM25 index is built per query from a bounded candidate set (no persistent index) — correct and never stale, but re-tokenizes per call (fine at demo scale). Reranker is lexical/metadata only. No RAG answers, no copilot, no agent wiring (by design).

---

## Phase 4 — Grounded Generation Layer + Retrieval-Augmented Investigation Briefing — ✅ COMPLETE

**Architecture**: ORION's first genuine RAG generation path. A reusable
`src/generation/` subsystem (context → prompt → LlmRunner → schema → citation →
evidence → grounding → policy → quality gate → audit) under a single read-only
use case in `src/briefing/`. The deterministic RCA stays **authoritative**;
retrieved documents are **untrusted supporting context**; generation status is
tracked separately from the provider execution mode; deterministic fallback is
never labeled real. `GroundedGenerationService` is the only generation caller of
the LLM and calls it **only** through `LlmRunner`. The six operational agents,
orchestrator, lifecycle, approvals, reports, and all Phase 0–3 functionality are
**unchanged**; `LlmRunner` remains **unwired** from the agents. No RAG chat, no
copilot, no tool calling, no autonomous action.

**Files added (backend)**: `src/generation/{types,schemas,contextBuilder,promptBuilder,citationValidator,evidenceValidator,groundingValidator,policyValidator,qualityGate,groundedGenerationService,repository}.ts`; `src/briefing/{types,prompt,deterministicBriefingFallback,briefingService}.ts`; `src/api/{briefing,generation}.ts`; `tests/{generation,briefingApi}.test.ts`. Docs: `docs/GROUNDED_GENERATION_ARCHITECTURE.md`, `docs/INVESTIGATION_BRIEFING.md`.

**Files modified**: `src/config.ts` (+`generation` block + `describeGenerationConfig`), `src/db.ts` (+`grounded_generation_executions` table + indexes), `src/services/llmAuditService.ts` (+`getLlmExecutionIdByCorrelation`), `src/app.ts` (mount briefing + generation routers), `.env.example`.

**Database**: new `grounded_generation_executions` table (correlation/investigation IDs, use case, generation status, linked `llm_execution_id`, provider mode/provider/model, prompt version, retrieval execution ID + mode, context/evidence/citation/excluded/injection counts, per-validator booleans, claim counts, average grounding support, latency, fallback/rejection reasons). **No prompts, no raw chunks, no raw responses, no secrets, no embeddings.**

**Config vars**: `ORION_GENERATION_MAX_CONTEXT_CHARS` (8000), `_MAX_EVIDENCE_ITEMS` (8), `_MAX_RETRIEVAL_CHUNKS` (6), `_MAX_TEXT_PER_SOURCE` (600), `_RETRIEVAL_TOP_K` (5), `_MIN_RETRIEVAL_CHUNKS` (1), `_MIN_GROUNDING_SUPPORT` (0.5), `_MAX_CLAIMS` (12), `_INJECTION_FILTER_ENABLED` (true). Bounded; offline defaults; startup unaffected when unset.

**APIs**: `POST /api/investigations/:id/briefing` (read-only; any authenticated role; no arbitrary prompt/provider/model/query; 404 missing, 409 no-RCA); `GET /api/generation/executions` + `/:id` (Director/Admin, filtered/paginated).

**Deterministic fallback design**: the domain deterministic briefing is built up front and passed to LlmRunner as `fallbackSeed`; when the runner falls back (or a real output is rejected) the service uses the domain briefing (validated through the same pipeline) → `DETERMINISTIC_FALLBACK_ACCEPTED`, never labeled real.

**Regression results (verified this session)**
- Backend typecheck ✅ · Backend tests **199/199** (was 164; +27 generation, +8 briefing API).
- Frontend typecheck ✅ · Frontend tests **11/11** · Frontend production build ✅.
- Runtime smoke (fresh offline instance): briefing for the seeded investigation → `DETERMINISTIC_FALLBACK_ACCEPTED`, authoritative root cause preserved, resolvable citations, no secrets; analyst allowed; no-RCA → 409; missing → 404; generation audit RBAC (analyst 403 / director 200); LLM + retrieval + generation audits persisted; deterministic investigation workflow + LLM `DETERMINISTIC_FALLBACK` labeling intact.

**Known limitations**: grounding is lexical (not semantic); the deterministic fallback faithfully summarizes retrieved context rather than composing analytical prose; offline default always yields `DETERMINISTIC_FALLBACK_ACCEPTED` (real-provider path is mock-tested); injection defense is best-effort, not a guarantee. No agent wiring / copilot / tool calling (by design).

---

## Phase 5 — Mission Copilot + Controlled Read-Only Tool Calling + Conversational RAG — ✅ COMPLETE

**Architecture**: a READ-ONLY conversational Copilot over the deterministic pipeline + grounded knowledge, built on LlmRunner (only) and the Phase 4 grounding philosophy. A fixed **allowlist tool registry** of 8 read-only tools, a bounded/timed/audited tool executor, a bounded tool-calling loop, short-term conversation memory (per-user, ownership-isolated), grounding/citation/evidence/policy validation, and a deterministic intent-routed fallback planner that drives the SAME tools offline. Deterministic core, six agents, orchestrator, lifecycle, approvals, reports, and all Phase 0–4 systems are **unchanged**; `LlmRunner` remains **unwired** from the operational agents. No planner/critic/reflection agents, no long-term memory, no autonomous actions.

**Files added (backend)**: `src/copilot/{types,schemas,prompt,toolRegistry,toolExecutor,copilotContextBuilder,copilotValidators,deterministicCopilotFallback,copilotService,conversationRepository,conversationService,copilotAuditRepository}.ts`; `src/copilot/tools/{getSatellite,getTelemetry,getAlerts,getInvestigation,getEvidence,getReport,searchMissionKnowledge,searchHistoricalInvestigations}.ts`; `src/api/copilot.ts`; `tests/{copilot,copilotApi}.test.ts`. Frontend: `src/lib/copilot.test.ts`. Docs: `docs/MISSION_COPILOT_ARCHITECTURE.md`, `docs/COPILOT_TOOL_SECURITY.md`, `docs/COPILOT_CONVERSATION_MEMORY.md`.

**Files modified**: `src/config.ts` (+`copilot` block + `describeCopilotConfig`), `src/db.ts` (+4 tables), `src/api/errors.ts` (CopilotValidationError→400), `src/app.ts` (mount `/api/copilot`), `.env.example`; frontend `src/api/client.ts` (copilot methods + types), `src/lib/format.ts` (`copilotModeBadge`), `src/components/AiDrawer.tsx` (rebuilt as Mission Copilot).

**Database**: `copilot_conversations`, `copilot_messages` (sanitized content only), `copilot_executions` (per-message audit), `copilot_tool_executions` (per-tool audit). No secrets, no raw prompts, no hidden reasoning, no raw vectors, no unrestricted payloads.

**Config vars**: `ORION_COPILOT_MAX_ITERATIONS` (4), `_MAX_TOOL_CALLS` (6), `_MAX_TOOL_OUTPUT_CHARS` (4000), `_MAX_MESSAGE_CHARS` (2000), `_MAX_CONTEXT_CHARS` (8000), `_MAX_RETAINED_MESSAGES` (20), `_MAX_EXECUTION_MS` (15000), `_TOOL_TIMEOUT_MS` (3000), `_MAX_SUGGESTED_FOLLOWUPS` (4). Bounded; offline defaults.

**APIs**: `GET /api/copilot/status`; `POST/GET /api/copilot/conversations`; `GET /api/copilot/conversations/:id`; `POST /api/copilot/conversations/:id/messages` (user message only — no provider/model/prompt/tool/mode/URL/SQL overrides); `POST /api/copilot/conversations/:id/archive`. Authenticated; per-user isolation.

**Regression results (verified this session)**
- Backend typecheck ✅ · Backend tests **228/228** (was 199; +20 copilot unit/service, +9 copilot API).
- Frontend typecheck ✅ · Frontend tests **14/14** (was 11; +3 copilot) · Frontend production build ✅.
- Runtime smoke (fresh offline instance): documented in the Phase 5 report — grounded answers, refusals for prohibited requests, tool + copilot audits, no fabricated IDs, no secrets, no mutation, LLM still `DETERMINISTIC_FALLBACK`.

**Known limitations**: offline default always yields `DETERMINISTIC_FALLBACK`/`INSUFFICIENT_EVIDENCE` (real-provider tool loop is mock-tested); grounding is lexical, not semantic; prompt-injection defense is best-effort; short-term memory only.

---

## Phase 6 — Bounded Planner Agent + Agentic RAG + Read-Only Investigation Analysis — ✅ COMPLETE

**Architecture**: a bounded, READ-ONLY Planner Agent that builds + executes an investigation-analysis plan (Agentic RAG) over the Phase 5 read-only tools, Phase 3 retrieval, LlmRunner, and Phase 4/5 grounding. Plan generation is real (LlmRunner) or deterministic; a strict plan validator + safety gate reject invalid/unsafe plans (→ deterministic). A bounded dependency-aware executor runs read-only steps and drives bounded iterative retrieval (deterministic gap detection + query refinement + duplicate prevention). A deterministic grounded `PlannerAnalysis` is produced and validated (citation/evidence/grounding/policy). Advisory-only (`ANALYSIS_ASSISTANCE_ONLY`); never mutates mission state; deterministic RCA preserved exactly; `LlmRunner` remains unwired from the six operational agents; no Critic/Reflection, no long-term memory, no autonomous actions.

**Files added (backend)**: `src/planner/{types,schemas,prompt,plannerContext,actionRegistry,planValidator,knowledgeGapDetector,retrievalQueryBuilder,deterministicPlanner,planExecutor,analysisBuilder,plannerValidators,plannerAuditRepository,plannerService}.ts`; `src/api/planner.ts`; `tests/{planner,plannerApi}.test.ts`. Docs: `docs/PLANNER_AGENT_ARCHITECTURE.md`, `docs/AGENTIC_RAG_ARCHITECTURE.md`, `docs/PLANNER_SECURITY_BOUNDARIES.md`.

**Files modified**: `src/config.ts` (+`planner` block + `describePlannerConfig`), `src/db.ts` (+3 tables), `src/app.ts` (mount planner routers), `.env.example`.

**Database**: `planner_executions`, `planner_step_executions`, `planner_retrieval_refinements`. No raw prompts, no hidden reasoning, no raw embeddings, no secrets, no unrestricted payloads.

**Config vars**: `ORION_PLANNER_MAX_STEPS` (10), `_MAX_ITERATIONS` (12), `_MAX_TOOL_CALLS` (16), `_MAX_RETRIEVAL_CALLS` (3), `_MAX_QUERY_REFINEMENTS` (2), `_MAX_OUTPUT_CHARS` (12000), `_MAX_EXECUTION_MS` (20000), `_STEP_TIMEOUT_MS` (4000), `_MIN_CITATIONS` (1), `_MIN_EVIDENCE_ITEMS` (1). Bounded; offline defaults.

**APIs**: `POST /api/investigations/:id/planner-analysis` (read-only; any authenticated role; body ignored — no prompt/plan/tools/provider/model/query overrides; 404 missing, 409 no-RCA); `GET /api/planner/executions[/:id]` (Director/Admin).

**Regression results (verified this session)**
- Backend typecheck ✅ · Backend tests **249/249** (was 228; +15 planner unit/service, +6 planner API).
- Frontend typecheck ✅ · Frontend tests **14/14** · Frontend production build ✅ (no frontend change required in Phase 6).
- Runtime smoke (fresh offline instance): documented in the Phase 6 report — grounded advisory analysis, deterministic + mocked-real plan paths, Agentic RAG refinement, bounded execution, audits, no fabricated IDs, no mutation, no secrets, LLM still `DETERMINISTIC_FALLBACK`.

**Known limitations**: offline default always yields `DETERMINISTIC_FALLBACK` (real plan path mock-tested); final analysis is deterministic (grounded summary, not LLM-composed prose); gap detection + query refinement are deterministic/lexical; no Critic/Reflection, no long-term memory, no autonomous actions.

---

## Phase 7 — Bounded Critic Agent + Reflection + Validated Revision Loop + Human Review — ✅ COMPLETE

**Architecture**: an independent, bounded, READ-ONLY Critic Agent that evaluates a Phase 6 Planner analysis before human review. It critiques claim grounding, citation/evidence validity, authoritative-RCA consistency, source coverage (investigation/evidence/telemetry/alerts/mission-knowledge/historical), contradictions, unsupported/overstated claims, policy violations, fabricated IDs, and missing limitations/knowledge gaps. It returns ACCEPT / REVISE / REJECT. On REVISE, a SEPARATE bounded deterministic `RevisionService` produces a revised analysis that must pass schema + citation + evidence + grounding + policy + authoritative-RCA validation before the Critic re-evaluates it. The reflection loop is strictly bounded (attempts, calls, time, repeated review/analysis detection via deterministic SHA-256 hashes). Advisory-only (`ANALYSIS_ASSISTANCE_ONLY`, `humanReviewRequired: true`); ACCEPT is not mission approval and REJECT is not investigation rejection; never mutates mission state; deterministic RCA preserved exactly; uses `LlmRunner` only (no direct provider calls); `LlmRunner` remains unwired from the six operational agents. No long-term/semantic memory, no ChromaDB, no autonomous actions, no recursive agent spawning.

**Files added (backend)**: `src/critic/{types,schemas,prompt,criticContextBuilder,criticGrounding,coverageEvaluator,contradictionDetector,deterministicCritic,criticValidators,revisionService,criticService,criticAuditRepository}.ts`; `src/api/critic.ts`; `tests/{critic,criticApi}.test.ts`. Docs: `docs/CRITIC_AGENT_ARCHITECTURE.md`, `docs/REFLECTION_REVISION_LOOP.md`, `docs/CRITIC_SECURITY_BOUNDARIES.md`.

**Files modified**: `src/config.ts` (+`critic` block + `describeCriticConfig`), `src/db.ts` (+3 tables), `src/app.ts` (mount critic review + audit routers), `.env.example`.

**Database**: `critic_executions`, `critic_issues`, `critic_revision_attempts` (+ indexes; additive, old-DB compatible). No raw prompts, no hidden reasoning, no raw model responses, no raw vectors, no secrets, no unrestricted payloads — bounded summaries only.

**Config vars**: `ORION_CRITIC_MAX_ISSUES` (20), `_MAX_REVISION_ATTEMPTS` (2), `_MAX_CALLS` (6), `_MAX_CONTEXT_CHARS` (12000), `_MAX_EXECUTION_MS` (20000), `_MIN_COVERAGE_ITEMS` (6), `_NUMERIC_TOLERANCE` (0.05). Bounded; safe offline defaults.

**APIs**: `POST /api/planner/executions/:id/critic-review` (read-only; any authenticated role; body ignored — no prompt/review/analysis/provider/model overrides; 400 bad id, 404 unknown planner execution); `GET /api/critic/executions[/:id]` (Director/Admin, paginated/filterable).

**Regression results (verified this session)**
- Backend typecheck ✅ · Backend tests **293/293** (was 249; +38 critic unit/service, +6 critic API).
- Frontend typecheck ✅ · Frontend tests **14/14** · Frontend production build ✅ (no frontend change required in Phase 7).
- Runtime smoke (fresh offline instance): critic-review of a Planner execution → `DETERMINISTIC_FALLBACK`, ACCEPT, `ANALYSIS_ASSISTANCE_ONLY`, `humanReviewRequired: true`, RCA `COMMUNICATION_SUBSYSTEM_FAILURE` preserved, no fabricated IDs, no confidence field, no secrets; unknown planner execution → 404; audit RBAC analyst 403 / director 200; investigation 1 unchanged (RESOLVED); LLM still `DETERMINISTIC_FALLBACK`.

**Boundary verification**: operational agents + orchestrator import nothing from `critic`/`planner`/`copilot` and no `LlmRunner`; `src/critic` imports `LlmRunner` only (no direct provider imports); the Critic never mutates the Planner analysis directly (separate `RevisionService`); no Critic/long-term-memory/ChromaDB/autonomous modules beyond the bounded reflection loop.

**Known limitations**: offline default always yields `DETERMINISTIC_FALLBACK` (real review path mock-tested); coverage/contradiction/grounding/overstatement checks are deterministic and lexical (not semantic); revision is deterministic (not LLM-composed); no long-term/semantic memory, no ChromaDB, no autonomous actions.

---

## Phase 8 — Read-Only AI Evaluation, Observability & Governance — ✅ COMPLETE

**Baseline recorded before Phase 8 (verified this session):** Backend typecheck ✅ · Backend tests **293/293** · Frontend typecheck ✅ · Frontend tests **14/14** · Frontend production build ✅. Not a git repository (filesystem is the source of truth). Baseline was clean before any Phase 8 change.

**Architecture**: a read-only AI Observability, Evaluation & Governance subsystem that aggregates the EXISTING Phase 1–7 audit tables (the single source of truth — no new event pipeline) into strongly-typed metrics, plus a premium Director/Admin frontend dashboard. Strictly read-only: never mutates configuration, mission state, agents, investigations, or provider selection. Deterministic (`now` injected for tests). Ranking/quality signals (retrieval similarity, rerank, grounding support, coverage, Precision/Recall/MRR/nDCG) are never labeled confidence; deterministic fallback is never labeled real model output. Offline-first.

**Files added (backend)**: `src/observability/{types,aggregation,observabilityRepository,metrics,governance,observabilityService}.ts`; `src/api/observability.ts`; `tests/{observability,observabilityApi}.test.ts`. **Frontend**: `src/pages/AiEvaluationPage.tsx`; `src/lib/observability.ts` (+ `observability.test.ts`). Docs: `docs/AI_OBSERVABILITY_ARCHITECTURE.md`, `docs/AI_EVALUATION_DASHBOARD.md`, `docs/AI_GOVERNANCE_METRICS.md`.

**Files modified**: `src/config.ts` (+`observability` block + `describeObservabilityConfig`), `src/app.ts` (mount `/api/observability`, Director/Admin), `.env.example`; frontend `src/App.tsx` (route), `src/auth/permissions.ts` (`/ai-evaluation` → Director/Admin), `src/components/AppShell.tsx` (nav item), `src/api/client.ts` (obs methods + types).

**Database**: none. Phase 8 is pure read-only aggregation over existing audit tables via parameterized SQL and a fixed internal table allowlist (no arbitrary table/column selection, no writes).

**Config vars**: `ORION_OBSERVABILITY_DEFAULT_RANGE` (7D), `_MAX_RANGE_DAYS` (30), `_MAX_ROWS` (100000), `_TIMESERIES_BUCKET_LIMIT` (48), `_MAX_DISTRIBUTION_ITEMS` (12), `_MAX_EVALUATION_HISTORY` (25), and 10 `_GOV_*` advisory governance thresholds. Bounded; safe offline defaults; sanitized status.

**APIs** (Director/Admin, read-only): `GET /api/observability/{status,overview,llm,retrieval,generation,copilot,planner,critic,governance,evaluations,snapshot}` and `/timeseries?metric=<allowlisted>&range=`. `range` allowlisted (invalid → default); `metric` allowlisted (invalid/missing → 400).

**Regression results (verified this session)**
- Backend typecheck ✅ · Backend tests **320/320** (was 293; +18 observability unit + service, +9 observability API).
- Frontend typecheck ✅ · Frontend tests **21/21** (was 14; +7 observability helpers) · Frontend production build ✅.
- Runtime smoke (fresh offline instance, throwaway DB): status read-only + offline + `DETERMINISTIC_FALLBACK` + `LOCAL_HASH_FALLBACK`; all 11 subsystem APIs 200 (Director/Admin); overview/governance(advisory)/evaluations/time-series (48 bounded points) all correct; invalid metric → 400; invalid range → graceful default; analyst 403; admin 200; no Bearer/embedding_json/raw prompt/response/confidence key in responses; investigation 1 unchanged (RESOLVED).

**Security + boundary verification**: agents + orchestrator import nothing from observability/critic/planner/copilot and no `LlmRunner`; `src/observability` performs zero writes (SELECT/COUNT only, parameterized, allowlisted tables); no secrets/raw prompts/responses/vectors in APIs or frontend; `LlmRunner` remains unwired from the six operational agents; deterministic RCA, six agents, orchestrator, lifecycle, approvals, and reports unchanged; LocalHashEmbedding remains `LOCAL_HASH_FALLBACK`, LLM remains `DETERMINISTIC_FALLBACK` when unconfigured.

**Known limitations**: aggregation is over the most recent `MAX_ROWS` rows within range (bounded; exact for the offline dataset); `repeatedReviewStopCount` is not individually persisted (0 unless a future schema records it); metrics are descriptive, not predictive; offline planner/critic do not invoke `LlmRunner`, so `llm_executions` (and thus LLM rate metrics) are populated only when a real provider is configured or the briefing/copilot LLM path runs.

---

## Phase 9 — Real-Provider GenAI + Real Semantic Embeddings + Provider Verification & Evaluation — ✅ COMPLETE

**Baseline before Phase 9 (verified):** Backend typecheck ✅ · Backend tests **320/320** · Frontend typecheck ✅ · Frontend tests **21/21** · Frontend build ✅. Not a git repository.

**Architecture**: real-provider LLM generation and real semantic embeddings, provider capability model, live verification/conformance, embedding-space identity + registry + controlled corpus re-embedding, fail-closed space-aware retrieval, and a real-vs-fallback comparison harness — all opt-in and offline-first. `LlmRunner` remains the only application path to an LLM provider (unwired from the six operational agents); `EmbeddingProvider` remains the only embedding abstraction. Deterministic fallback is never labeled real; a live path is verified only when a real endpoint was reached and accepted.

**Files added (backend)**: `src/providers/{types,providerCapabilities,providerValidation,providerRegistry,providerHealthService,providerRepository,embeddingSpace,embeddingSpaceService}.ts`; `src/evaluation/{providerComparisonTypes,providerComparisonService}.ts`; `src/api/providers.ts`; `tests/{providers,providersApi}.test.ts`. **Frontend**: `src/components/ProviderPanel.tsx`, `src/lib/providers.ts` (+`providers.test.ts`). **Docs**: `REAL_PROVIDER_ARCHITECTURE.md`, `REAL_LLM_PROVIDER_CONFIGURATION.md`, `REAL_EMBEDDING_PROVIDER_CONFIGURATION.md`, `EMBEDDING_SPACE_MIGRATION.md`, `PROVIDER_VERIFICATION.md`, `REAL_VS_FALLBACK_EVALUATION.md`.

**Files modified**: `src/config.ts` (+`providers` block, endpoint-trust + safe-config helpers, `describeProvidersConfig`), `src/db.ts` (+4 tables + `knowledge_chunks.embedding_space_key` additive column), `src/knowledge/{types,repository,vectorStore,retrievalService}.ts` (embedding-space integrity + fail-closed retrieval + diagnostics), `src/observability/{types,observabilityRepository,observabilityService,providerMetrics(new)}.ts` (provider observability + governance), `src/api/{app,errors}.ts`, `.env.example`; frontend `src/App.tsx`? (no route change — panel lives on `/ai-evaluation`), `src/api/client.ts`, `src/pages/AiEvaluationPage.tsx`. Docs `AI_OBSERVABILITY_ARCHITECTURE.md`, `AI_GOVERNANCE_METRICS.md`, `AI_EVALUATION_DASHBOARD.md`.

**Database**: `provider_verification_executions`, `embedding_spaces`, `embedding_reindex_executions`, `provider_comparison_runs`, `provider_comparison_results` (+ indexes; additive) + `knowledge_chunks.embedding_space_key`. No API keys/headers/prompts/responses/vectors/hidden reasoning stored.

**Regression results (verified)**: Backend typecheck ✅ · Backend tests **348/348** (was 320; +19 provider unit/service, +9 provider API). Frontend typecheck ✅ · Frontend tests **27/27** (was 21; +6 provider helpers). Frontend build ✅. Offline runtime smoke: providers OFFLINE, verify → NOT_CONFIGURED (never real), reindex COMPLETED (LocalHash, single active space), VECTOR retrieval works within active space (0 mismatches), comparison realAvailable=false + realAccepted=0 (honest), analyst 403, briefing/planner/observability intact, investigation unchanged, no secrets. **LIVE_LLM_VERIFICATION = NOT_EXECUTED**, **LIVE_EMBEDDING_VERIFICATION = NOT_EXECUTED** (no credentials/network in this environment).

**Boundary/secret verification**: agents + orchestrator unchanged (no provider/LlmRunner imports); no direct provider `fetch` in briefing/copilot/planner/critic; no hardcoded secrets in provider code; no credentials in status/APIs; deterministic RCA + LocalHashEmbedding labeling + deterministic-fallback labeling preserved; no mixed embedding spaces (fail-closed).

---

## Phase 10 — ORION AI Assistant (Fully Functioning Agentic AI Chatbot) — ✅ COMPLETE

**Baseline before Phase 10 (verified this session, STEP 0):** Backend typecheck ✅ · Backend tests **348/348** (24 files) · Frontend typecheck ✅ · Frontend tests **27/27** (4 files) · Frontend production build ✅. Not a git repository (filesystem is the source of truth). Baseline was clean before any Phase 10 change.

**Result (verified):** Backend typecheck ✅ · Backend tests **384/384** (26 files; +36) · Frontend typecheck ✅ · Frontend tests **36/36** (5 files; +9) · Frontend build ✅. Offline runtime smoke green (deterministic fallback + LocalHash embeddings, all capabilities, streaming, feedback, evaluation, observability, no mission mutation, no secrets). **ASSISTANT_LIVE_LLM_VERIFICATION = NOT_EXECUTED** and **ASSISTANT_LIVE_EMBEDDING_VERIFICATION = NOT_EXECUTED** (no provider credentials/network in this environment). See `ORION_AI_ASSISTANT_ARCHITECTURE.md` + the 7 companion docs.

## Phase 11 — ⏸ AWAITING EXPLICIT APPROVAL

Candidate: **multi-conversation workspace intelligence + proactive advisory digests** — cross-conversation (still per-user, still short-term) saved views, a Director/Admin "what changed / what to review next" read-only digest synthesized from existing deterministic pipeline + assistant audits, and optional real-provider multi-provider routing/failover reused from a future provider-routing phase. All read-only, opt-in, same boundaries, full regression gate. Not started; do not begin without approval.

**Objective:** Upgrade the existing Phase 5 Mission Copilot into a complete, production-style ORION AI Assistant (`/api/assistant`, `/ai-assistant`). Reuse — never duplicate — the Copilot conversation store, tool registry/executor, validators, deterministic fallback, LlmRunner, provider architecture, active embedding-space retrieval, and Planner/Critic services. Adds: capability catalog, intent routing, deterministic multi-turn context resolution, bounded conversation memory/summarization, dynamic bounded tool calling, Planner/Critic/validated-workflow chat invocation, Agentic RAG, grounded structured answers + quality gate, rich answer cards, safe staged SSE streaming, citation/source inspection, feedback, a fixed evaluation harness, Assistant observability + governance, and a premium full-page frontend. Execution-mode integrity preserved throughout: deterministic fallback is never labeled real; LocalHash embedding is never labeled real semantic; mock ≠ live.
