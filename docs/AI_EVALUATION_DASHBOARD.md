# AI Evaluation Dashboard (Phase 8)

A premium, **read-only** frontend page — `AI Evaluation & Observability` at
`/ai-evaluation` — that visualizes the observability metrics. Director/Admin only
(route-guarded client-side by `ROUTE_ROLES`; the backend enforces RBAC
independently). Matches the existing ORION dark-industrial visual design and
reuses the shared `Panel` / `StatCard` / `LoadingState` / `ErrorState` /
`EmptyState` components, Tailwind accent palette, and Recharts patterns.

## Route + access

- Path: `/ai-evaluation` (nav item "AI Evaluation" under the Intelligence group).
- `ROUTE_ROLES['/ai-evaluation'] = ['MISSION_DIRECTOR','SYSTEM_ADMIN']`; the nav
  item is filtered by `canAccess`, and `ProtectedRoute` redirects non-privileged
  users. The backend `/api/observability/*` routes are Director/Admin-gated too.

## Layout

- **Header** with title, description, and a time-range selector (24H / 7D / 30D /
  All Time) with `aria-pressed` state.
- **Offline / fallback banner**: shows the LLM operating mode (deterministic
  fallback vs real provider configured) and the embedding mode (LocalHashEmbedding
  labeled "lexical, not neural"), plus the explicit note that deterministic
  fallback is not real model output and scores are not confidence.
- **KPI cards**: Total AI Executions, Real Provider Rate, Deterministic Fallback
  Rate, Grounded Output Acceptance Rate, Retrieval nDCG@K, Critic Acceptance
  Rate, Governance Alert Count.
- **Charts**: AI Executions Over Time (line, from `/timeseries?metric=ai_executions`),
  LLM Execution Mode (donut), Retrieval Mode Distribution, Generation Status
  Distribution, Copilot Tool Usage, Planner Status Distribution, Critic Decision
  Distribution, Latency p50/p95/p99 by subsystem (grouped bars), Grounding &
  Citation Validity, Governance Alerts by Severity.
- **Panels**: latest retrieval evaluation results (table), pipeline health
  summary, top fallback reasons, top failure/error codes, recent governance
  alerts (severity-colored), and the offline/fallback banner.

## States

Loading (spinner), API error (with retry), and empty (per-chart empty states) are
all handled. A single `/observability/snapshot` call plus one `/timeseries` call
populate the page; changing the range refetches.

## Safety in the UI

- Deterministic fallback is **never** labeled as real AI / "AI Model" (see
  `executionModeLabel`, unit-tested).
- Evaluation metrics and grounding/coverage rates are labeled as ranking/quality
  signals — **never confidence** (`score`, `pct`, in-panel notes).
- No raw prompts, raw responses, tool payloads, vectors, or secrets are ever
  requested or rendered — the API only returns bounded aggregates.
- Governance alerts are rendered with an explicit "advisory only" note.

## Phase 9 — Providers & Live AI Evaluation surface

The page renders a `ProviderPanel` (`src/components/ProviderPanel.tsx`) at the top:
a status banner (OFFLINE / CONFIGURED — NOT VERIFIED / REAL PROVIDER ACTIVE /
DEGRADED TO DETERMINISTIC FALLBACK), LLM + embedding provider status cards
(provider, model, operating mode, last verification), the active embedding space,
re-index progress, real-vs-fallback comparison summary, recent verifications, and
four controlled Director/Admin actions — Verify LLM, Verify Embedding, Start
Corpus Re-Embedding, Run Real-vs-Fallback Evaluation — each gated behind a
`ConfirmationModal` (explicit confirmation before any external-provider call).
Pure helpers (`src/lib/providers.ts`) guarantee deterministic fallback is never
labeled as real AI and scores are never labeled confidence.

## Tests

`src/lib/observability.test.ts` (pure helpers): range options, `pct`/`ms`/`count`/
`score` formatting + null-safety, execution-mode labeling (fallback never labeled
real), operating-mode labeling, and governance severity classes. Component
composition is validated by the production build + typecheck (no
`@testing-library/react` dependency is added).

## Phase 10 — ORION AI Assistant

A dedicated full-page assistant experience lives at `/ai-assistant` (all
authenticated roles; privileged workflows respect existing RBAC). The AI Evaluation
dashboard's observability snapshot additionally carries the `assistant` block; the
Director/Admin assistant evaluation harness (`/api/assistant/evaluations`) reports
intent/context/tool/grounding/refusal accuracy with deterministic assertions and is
honest about real-provider availability. Frontend labeling helpers
(`src/lib/assistant.ts`, unit-tested) guarantee deterministic fallback is never
shown as real AI and grounding support is never labeled confidence.
