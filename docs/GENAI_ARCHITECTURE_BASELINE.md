# PROJECT ORION — GenAI Architecture Baseline (Phase 0)

Snapshot of the **actual** system as discovered on disk before any GenAI work. This is the ground truth the GenAI layer will be built *around* — not replace.

_Verified: backend typecheck 0 errors, 38 backend tests pass; frontend typecheck 0 errors, 11 frontend tests pass; frontend production build succeeds._

---

## 1. Stack discovered

| Layer | Technology | Notes |
|------|-----------|------|
| Runtime | **Node.js v25**, TypeScript (ESM) | No Python (not installed / cannot install). Backend chosen as Node earlier for this reason. |
| Backend | **Express 4**, run via `tsx` | Entry `src/index.ts` → `buildApp()` in `src/app.ts`. Binds `127.0.0.1:8000` only. |
| Database | **SQLite via built-in `node:sqlite`** (`DatabaseSync`) | Zero native deps. File `backend/data/orion.db`. Loaded via `createRequire` to dodge bundler resolution. Typed facade in `db.ts`. |
| Frontend | **React 18 + Vite 5 + TypeScript**, Tailwind 3, React Router 6, Recharts, lucide-react | Dev server `127.0.0.1:5173`, proxies `/api` → backend. |
| Auth | **Custom JWT (HS256) via `node:crypto`** + scrypt password hashing | No external auth libs. |
| Tests | **Vitest** (backend + frontend) | Backend: `:memory:` DB per file + `node:sqlite` external + `.js`→`.ts` resolver plugin. Frontend: jsdom + in-memory Storage polyfill. |
| External data | NOAA SWPC, CelesTrak, OpenAlex — **OFFLINE_FIXTURE by default** | TTL cache + provenance + fixture fallback. No live network calls. |

**Offline-first is a hard environment constraint** (company-managed laptop, no admin installs, no guaranteed network). Every existing external dependency already has a deterministic offline fallback. The GenAI layer must follow the same pattern.

## 2. Database schema (10 tables)

`satellites`, `telemetry`, `alerts`, `investigations`, `evidence`, `recommendations`, `agent_executions`, `reports`, `system_settings`, `users`.

Key relationships: an `investigation` has many `evidence`, `recommendations`, `agent_executions`, `reports`; `alerts` link to an investigation; `evidence` carries provenance (`source_type`, `source_name`, `source_url`, `mode`, `cached`, `fallback_used`, `reliability_score`, `supports_root_cause`).

## 3. Deterministic reasoning pipeline (MUST be preserved — rule 4)

- `analysis/anomalyRules.ts` — configurable thresholds + persistence-based violation detection.
- `analysis/scoring.ts` — **deterministic weighted evidence scoring** (`computeScores`, `computeConfidence`, bounded 0.50–0.97).
- `analysis/rootCauseKnowledgeBase.ts` — hand-authored anomaly→root-cause weights + recommendations.
- `analysis/rootCauseEngine.ts` — combines evidence bundle → root cause, confidence, severity, supporting/contradicting evidence, scoring breakdown.

These are pure, testable, reproducible. **The GenAI layer will generate narrative/hypotheses/explanations around this scoring but will not become the scorer.**

## 4. Current agents + orchestration

Six deterministic agents (`agents/`), all extend `BaseAgent` which records an `AgentExecution` row (status/timing/summaries/errors):
1. Telemetry Monitoring 2. Anomaly Detection 3. Space Weather (NOAA offline) 4. Orbit Intelligence (CelesTrak offline) 5. Root Cause Analysis (deterministic engine) 6. Report Generation (OpenAlex offline refs).

`orchestrator/investigationOrchestrator.ts` runs them **sequentially**, stores evidence + RCA + recommendations, transitions investigation state, tolerates adapter failure (fallback). No LLM, no planner yet.

## 5. Investigation lifecycle

`DETECTED → ANALYZING → WAITING_FOR_REVIEW → APPROVED | REJECTED → RESOLVED`. Auto-created by the simulation tick when anomalies persist. Human-in-the-loop approve/reject/resolve, then report generation. State transitions validated (409 on invalid).

## 6. Auth + RBAC (MUST be preserved — rule 2)

- Public: `/api/health`, `/api/auth/login`. All other `/api/*` require a valid Bearer JWT (`authenticate` middleware).
- Roles: `MISSION_DIRECTOR` (full), `MISSION_ANALYST` (read/monitor; no simulation, no settings), `SYSTEM_ADMIN` (dashboard + settings).
- `requireRole` enforced on: simulation start/stop/reset/inject, investigation approve/reject/resolve/rerun/generate-report, alert acknowledge (all `MISSION_DIRECTOR`); settings writes (`MISSION_DIRECTOR`|`SYSTEM_ADMIN`).
- Seeded users (scrypt-hashed): `director`, `analyst`, `admin` — all `Orion@123`.

## 7. REST API surface (current)

`/api/health`, `/api/auth/{login,me,logout}`, `/api/dashboard/{summary,telemetry,recent-alerts,investigations,insights,space-weather}`, `/api/satellites(/:id/telemetry)`, `/api/telemetry(/latest)`, `/api/alerts(/:id/acknowledge)`, `/api/investigations(/:id, /approve, /reject, /resolve, /rerun-analysis, /generate-report, /agent-executions)`, `/api/simulation/{status,start,stop,reset,inject-failure}`, `/api/agents(/executions)`, `/api/integrations/status`, `/api/reports(/:id)`, `/api/settings/thresholds(+/reset)`.

## 8. Frontend "Ask Orion AI" (current state)

`components/AiDrawer.tsx` — a slide-in drawer that **surfaces real deterministic AI insights** (RCA results, recommendations, agent executions, active investigations) from existing endpoints. Explicitly labeled "not a conversational assistant." This is the seam where the **Mission Copilot with tool-calling (Phase 8)** will be built.

## 9. Environment configuration

`ORION_HOST`, `ORION_PORT`, `ORION_INTEGRATION_MODE` (default `OFFLINE_FIXTURE`), `ORION_TICK_MS`, `ORION_JWT_SECRET` (dev fallback + warning), `ORION_JWT_EXPIRES_SEC`, `ORION_DB_FILE` (`:memory:` for tests). No secrets committed; `.env.example` documents safe defaults.

## 10. Deployment configuration

Local only: `npm start` (backend, loopback) + `npm run dev` (frontend, loopback + proxy). No Docker, no cloud, no CI. Git not initialized.

## 11. Baseline verification results (run in Phase 0)

| Check | Command | Result |
|------|---------|--------|
| Backend typecheck | `npx tsc --noEmit` | ✅ 0 errors |
| Backend tests | `npx vitest run` | ✅ **38/38** (anomalyRules 8, rootCause 8, integrations 3, demoFlow 3, auth 16) |
| Frontend typecheck | `npx tsc --noEmit` | ✅ 0 errors |
| Frontend tests | `npx vitest run` | ✅ **11/11** (auth logic) |
| Frontend build | `npm run build` | ✅ built (~202 KB gzip) |

**Baseline is clean. Cleared to plan Phase 1.**
