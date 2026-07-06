# Dynamic Simulation — Architecture Audit

Inspection performed before any refactor. Classifies every simulation-related
dependency and locates the concrete demo/seed/hardcoded coupling that the
Satellite Simulation Control Center refactor must remove.

Legend: **DYNAMIC** (already satellite-driven) · **PARTIALLY_DYNAMIC** ·
**DEMO_DEPENDENT** (built around demo scenarios) · **SEED_DEPENDENT** (assumes the
5 seeded ORION-N) · **HARDCODED** (literal satellite ids / scenario maps) ·
**NOT_APPLICABLE**.

## Repository search results

| Term | Where found (pre-refactor) |
|------|----------------------------|
| `Demo` / `Demo Launcher` / `Demo Scenarios` | `frontend/src/pages/SimulationPage.tsx` (page title "Simulation & Demo Launcher", `Panel title="Demo Scenarios"`); `simulationService.reset()` ("RESET DEMO"); `backend/tests/demoFlow.test.ts` |
| `PRIMARY` | `SimulationPage.tsx` (`SCENARIOS[0].primary`, "Primary" badge) |
| `Start Scenario` | `SimulationPage.tsx` (`launchScenario`, button label) |
| `scenarioId` | none (scenarios were a frontend-only `SCENARIOS` array) |
| `ORION-1..ORION-5` | `SimulationPage.tsx` `SCENARIOS` (fixed target per scenario); `seed/seedData.ts` `SATELLITE_SEED`; `simulationService` seed-target registration + `reset()` |
| `resetDemo` / `runDemo` / `startScenario` | conceptually present as `reset()` + `launchScenario()` |
| hardcoded target satellite | `SimulationPage.tsx` telemetry chart defaulted to `ORION-3`; `dashboard.pickFocusSatellite` (already made dynamic in the onboarding pass) |

## Module-by-module classification

| Module / file | Classification | Finding |
|---|---|---|
| `frontend/src/pages/SimulationPage.tsx` | **DEMO_DEPENDENT / HARDCODED** | Whole page is a demo launcher: 5 hardcoded `SCENARIOS` mapping fixed ORION ids → failure, a PRIMARY card, "Start Scenario" buttons, a destructive "Reset" that "clears active alerts & open investigations", and a telemetry chart hardcoded to `ORION-3`. **Fully replaced.** |
| `frontend/src/api/client.ts` (simulation methods) | **DEMO_DEPENDENT** | `startSimulation/stopSimulation/resetSimulation/injectFailure` (global, no session). Replaced by session-scoped client methods. |
| `backend/src/api/simulation.ts` | **DEMO_DEPENDENT / SEED_DEPENDENT** | Global `/start /stop /reset /inject-failure`; `/reset` is destructive; `/inject-failure` validates but has no session model. Replaced with a session/failure/catalog surface. `/reset` removed. |
| `backend/src/services/simulationService.ts` | **SEED_DEPENDENT** | Single global engine. `ensureSeedTargets()` auto-registers the seeded fleet as sim targets (automatic target selection). `reset()` destructively deletes ACTIVE/ACKNOWLEDGED alerts + non-RESOLVED investigations and their children. One global `failures` map keyed by satellite → **only one failure per satellite** (no multi-failure). No pause/resume/speed/duration/telemetry-config. In-memory only (no restart visibility). **Refactored to a session-based engine.** |
| telemetry generator (`seed/seedData.nominalTelemetry` + `simulationService.applyFailure`) | **PARTIALLY_DYNAMIC** | Nominal wobble is generic; `applyFailure` handles the 5 legacy failure types with fixed rates and no severity/duration/onset. Superseded by a configurable per-field generator + failure-effect composition. |
| `backend/src/analysis/anomalyRules.ts` | **DYNAMIC** | Deterministic threshold rules keyed only on telemetry values + baseline altitude. Satellite-agnostic. **Reused unchanged** — remains the single anomaly engine. |
| `backend/src/services/anomalyService.ts` | **DYNAMIC** | Alert dedup/cooldown keyed by (satellite, anomaly_type). Reused unchanged. |
| `backend/src/services/investigationService.ts` | **DYNAMIC** | Investigation lifecycle keyed by satellite id. Reused unchanged. |
| six operational agents + `orchestrator/investigationOrchestrator.ts` | **DYNAMIC** | Keyed by investigation/satellite id. Reused unchanged. |
| deterministic RCA / evidence / reports | **DYNAMIC** | Investigation-id keyed. Reused unchanged. |
| anomaly persistence windows | **DYNAMIC** | `getRecentTelemetry(satelliteId, …)` — per-satellite. No cross-satellite leakage. |
| `backend/src/services/satelliteService.ts` | **DYNAMIC** | Canonical satellite CRUD + `isSimEligible()` + `findSatelliteIdInText()` (dynamic id resolution). Reused; the selector/failure-injection eligibility all route through `isSimEligible`. |
| dynamic satellite onboarding | **DYNAMIC** | Manual satellites persist and are sim-eligible; already flow to the engine via `startForSatellite`. The new selector lists them with no restart/seed change. |
| `backend/src/api/dashboard.ts` `pickFocusSatellite` | **DYNAMIC** | Already de-hardcoded in the onboarding pass (prefers an active satellite with telemetry; no ORION-3 literal). |
| Mission Copilot / ORION AI Assistant / Planner / Critic | **DYNAMIC (read-only)** | Resolve any persisted satellite via `findSatelliteIdInText`. `intentRouter`/`copilotValidators`/`deterministicCopilotFallback` already classify "reset/start/stop simulation" and "inject failure" as PROHIBITED. **Extended** to also cover pause/resume/remove-failure/clear-failures/change-speed/modify-telemetry so the new controls remain AI-unreachable. |
| observability / audits | **DYNAMIC** | Aggregate existing audit tables; unaffected. Simulation events are a separate bounded log. |
| WebSocket/SSE/polling | **NOT_APPLICABLE (polling)** | Frontend polls `/status` every 2s via `usePolling`; no simulation WebSocket. The Control Center keeps polling (bounded). |
| database tables | **SEED_DEPENDENT → fixed** | No simulation state was persisted (in-memory only). Added `simulation_sessions`, `simulation_failures`, `simulation_events`, `simulation_telemetry_config` (additive, backward-compatible). |
| `backend/tests/demoFlow.test.ts` | **DEMO_DEPENDENT** | Exercised `reset()` (destructive) + global `injectFailure`. Rewritten to the session model and to assert history is preserved (no destructive reset). |

## Architecture boundaries confirmed before implementation

1. **One anomaly engine.** `anomalyRules.evaluateViolations` is the only detector.
   Simulation only *emits telemetry*; it never creates alerts/investigations
   directly. This boundary is preserved.
2. **Per-satellite isolation.** Telemetry, anomaly windows, alerts and
   investigations are already keyed by satellite id. The refactor keeps failures
   and runtime state keyed by *session → satellite*, so concurrent simulations
   cannot leak.
3. **AI is read-only.** No write-capable simulation tool exists in any tool
   registry; prohibited-intent classification is deterministic and pre-tool.
4. **Seed coupling is localized.** The only real seed/demo coupling lived in
   `SimulationPage.tsx` (scenarios), `simulation.ts` API (`/reset`), and
   `simulationService` (`ensureSeedTargets` auto-registration + destructive
   `reset`). All three are removed/replaced; nothing downstream assumed the 5
   seeded satellites.
5. **Automatic target selection removed.** The engine no longer auto-registers the
   seeded fleet. Telemetry is generated only for satellites with an explicit,
   human-created RUNNING session.
