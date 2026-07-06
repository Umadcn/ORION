# Dynamic Satellite Integration Audit

Scope: identify every architectural assumption that PROJECT ORION operates only
on the five seeded satellites (`ORION-1..ORION-5`), so a manually-registered
satellite can flow through every applicable module. Classification per module:
**DYNAMIC** (already keyed by persisted satellite identity) · **PARTIALLY_DYNAMIC**
(works but has a seed fallback) · **SEED_DEPENDENT** (hard dependency to fix) ·
**NOT_APPLICABLE** · **BLOCKED_BY_EXTERNAL_DATA**.

## Findings

| # | Module | File(s) | Status | Notes / action |
|---|--------|---------|--------|----------------|
| 1 | Satellites schema | `db.ts` (`satellites`) | PARTIALLY_DYNAMIC | `id TEXT PK` is dynamic, but `norad_id/mission/orbit_type/altitude/velocity/latitude/longitude/health_score/status` are `NOT NULL` → cannot persist a satellite lacking orbital/telemetry data. **Action:** additive columns + honest data-state flags; no NOT-NULL drops (SQLite-safe). |
| 2 | Satellites list/get | `services/telemetryService.ts` (`getAllSatellites`, `getSatellite`) | DYNAMIC | Pure `SELECT … WHERE id=?` / `ORDER BY id`. No change. |
| 3 | Satellites API | `api/satellites.ts` | SEED_DEPENDENT (missing) | Only `GET /`, `GET /:id`, `GET /:id/telemetry`. **Action:** add create/patch/archive/reactivate + RBAC + honest detail states. |
| 4 | Telemetry persistence/query | `services/telemetryService.ts` | DYNAMIC | Keyed by `satellite_id`. No change. |
| 5 | **Simulation engine** | `services/simulationService.ts` | **SEED_DEPENDENT** | `tick()` loops `SATELLITE_SEED`; `injectFailure` requires `getSeedFor`; `reset()` restores only seeds. **Action:** refactor to an explicit **sim-target set** (seeds auto-registered for backward compat) + per-satellite start/stop + profile derived from persisted fields for dynamic sats. |
| 6 | Simulation API | `api/simulation.ts` | SEED_DEPENDENT | `inject-failure` validates via `getSeedFor` (blocks dynamic sats). **Action:** validate against persisted eligible satellites; add per-satellite start/stop. |
| 7 | Anomaly detection | `analysis/anomalyRules.ts`, tick window | DYNAMIC | Evaluated over a per-satellite telemetry window (`getRecentTelemetry(id)`); no in-memory seed map. No cross-satellite state leakage. No change. |
| 8 | Alerts | `services/anomalyService.ts`, `api/alerts.ts` | DYNAMIC | All keyed by `satellite_id` in SQL (dedupe/cooldown/association). No change. |
| 9 | Investigation creation + lifecycle | `services/investigationService.ts` | DYNAMIC | FK `satellite_id`; no seed assumption. No change. |
| 10 | Orchestrator (6 agents) | `orchestrator/investigationOrchestrator.ts` | PARTIALLY_DYNAMIC | `getSeedFor(id)?.altitude ?? satellite?.altitude ?? 0` already falls back to the persisted altitude. Works for dynamic sats. Minor: keep persisted-altitude path. |
| 11 | Six agents | `agents/*` | DYNAMIC | Load satellite/telemetry/alerts/evidence via repositories by id. No seed allowlist. No change (verify). |
| 12 | Deterministic RCA | `analysis/*`, agents | DYNAMIC | Operates on evidence/telemetry of the investigation's satellite. Honest insufficient-evidence path preserved. No change. |
| 13 | Reports | `services/reportService.ts` | DYNAMIC | Built from the investigation + its satellite. No change (verify metadata). |
| 14 | Dashboard summary | `api/dashboard.ts` | DYNAMIC | Counts from `getAllSatellites()` + live `COUNT(*)`. **Minor:** default-satellite fallback returns literal `'ORION-3'` → change to first persisted satellite. |
| 15 | Global search | `components/GlobalSearch.tsx` (frontend) + `/satellites` | DYNAMIC | Searches the live satellites list (polled). No startup-only index. No change (verify). |
| 16 | Orbit/Trajectory | `pages/OrbitPage.tsx` | PARTIALLY_DYNAMIC | Renders from each satellite's persisted `orbit_type/altitude/lat/long`. **Action:** honest `ORBIT_DATA_UNAVAILABLE` when a manual sat has none; never copy another sat's orbit. |
| 17 | CelesTrak integration | `integrations/celestrak.ts` | BLOCKED_BY_EXTERNAL_DATA | Fixture/feed keyed by object name; not a per-arbitrary-NORAD resolver. External TLE for arbitrary manual NORAD not auto-resolved → honest UNAVAILABLE. |
| 18 | Copilot tools (8) | `copilot/tools/*` | DYNAMIC | `getSatellite`/`getTelemetry`/… query persistence by id. No seed map. No change (verify). |
| 19 | AI Assistant | `assistant/*` | DYNAMIC | Context resolution validates ids against `satellites`/`investigations` tables (Phase 10). No hardcoded ORION list. No change (verify). |
| 20 | Planner / Critic | `planner/*`, `critic/*` | DYNAMIC | Context built from a real investigation id; no fixture allowlist. No change (verify). |
| 21 | Observability/audits | `observability/*` | DYNAMIC | Aggregates audit rows; no per-satellite high-cardinality labels. No change. |
| 22 | Frontend satellites client | `api/client.ts` | SEED_DEPENDENT (missing) | Only read methods. **Action:** add create/update/archive/reactivate + list(includeArchived). |
| 23 | Assistant eval seed pick | `assistant/assistantEvaluation.ts` | DYNAMIC | Already `SELECT … LIMIT 1` with `'ORION-1'` only as a last-resort literal when the DB has zero satellites. No change. |
| 24 | Knowledge/RAG seed content | `knowledge/seed.ts`, `retrieval/evaluationDataset.ts` | NOT_APPLICABLE | Historical KB documents legitimately reference `ORION-3`; not a runtime dependency. Do NOT auto-ingest KB for new sats. |

## Conclusion

The runtime seed dependency is **narrow and contained**: essentially the
**simulation engine** (telemetry generation loop + failure injection + reset) and
the **satellite API surface** (no create/manage endpoints). Telemetry, alerts,
anomaly detection, investigations, agents, RCA, lifecycle, reports, Copilot,
Assistant, Planner, Critic, dashboard, and observability are already keyed by
persisted satellite identity. The plan therefore: (a) additive schema + honest
data states, (b) satellite management service + APIs + RBAC, (c) refactor
simulation to an explicit dynamic sim-target set (seeds auto-registered for
backward compatibility), (d) honest orbit/telemetry "unavailable" states,
(e) frontend management UI + selectors, (f) full tests + E2E. No architecture
rewrite; all Phase 0–10 behavior preserved.
