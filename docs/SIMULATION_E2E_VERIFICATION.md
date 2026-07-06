# Satellite Simulation Control Center — E2E Verification

All results below were executed this session (offline / deterministic-fallback).

## Automated tests

- **`backend/tests/simulation.test.ts` — 29 tests** (service + real-HTTP API):
  deterministic composition + conflict resolution (highest-precedence wins, no
  double-apply, disjoint fields all apply, expiry/recovery, removed never applies);
  failure catalog completeness + serialization; session lifecycle + invalid
  transitions; one-session-per-satellite idempotency; pause→no-telemetry→resume;
  **concurrent multi-satellite isolation** (SIM-A heated, SIM-B comms-degraded, no
  cross-leakage); no duplicate open investigation; multi-failure + individual
  removal + clear-all; duration expiry; speed + config bounds; **restart recovery**
  (RUNNING→INTERRUPTED, no auto-emit, explicit resume); auth (401) + RBAC (analyst
  view 200 / mutate 403, director/admin mutate); bad-spec 400 + details; **AI
  Assistant/Copilot refuse simulation control + mutate nothing**.
- **`backend/tests/demoFlow.test.ts` — 3 tests**: full session-based pipeline
  (ORION-3 POWER_SYSTEM_FAILURE → LOW_BATTERY + ABNORMAL_POWER_CONSUMPTION alerts →
  investigation → 6 agents → RCA `PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION` → approve →
  resolve → report); no duplicate investigations; **STOP is non-destructive** (no
  new telemetry, alerts/history preserved).
- **`backend/tests/dynamicSatellite.test.ts` — 18 tests** (unchanged, still green):
  manual satellite compatibility + `startForSatellite` + cross-satellite isolation.
- **`frontend/src/lib/simulation.test.ts` — 8 tests**: speed options, real telemetry
  fields, RBAC, lifecycle-transition gating, active-failure filtering, dynamic
  satellite-selector filter, field formatting, live-session detection.

Full suites: **Backend 431/431** (28 files) · **Frontend 51/51** (7 files) · both
typecheck clean · frontend production build ✅.

## Runtime E2E over real HTTP (throwaway FILE database, cross-process restart)

Backend booted on a throwaway `orion_e2e.db` (real `orion.db` untouched):

1. `POST /api/satellites` `SAT-E2E-01` → **201**.
2. `GET /api/simulation/satellites` includes `SAT-E2E-01` immediately — **no
   restart, no seed change**.
3. `POST /api/simulation/sessions` (with a custom telemetry profile) + `/start`
   → **200**; the real background ticker generated **5 samples in ~7s**
   (only for the selected satellite).
4. `POST …/failures` (LOW_BATTERY, HIGH) → **201**; `PATCH …/speed` 5× → **200**
   (telemetry then accelerated to 231 samples).
5. AI Assistant `"Inject a LOW_BATTERY failure into SAT-E2E-01."` → **REFUSED**;
   `simulation_failures` unchanged.
6. **Cross-process restart**: killed the backend PID (session was `RUNNING`, 231
   samples). Restarted on the same file DB:
   - session status → **INTERRUPTED** (no silent resume),
   - telemetry preserved and **stable at 236 over 4s** (no auto-emit, no duplicate
     worker),
   - injected failure still present (`LOW_BATTERY`),
   - explicit `POST …/resume` → **RUNNING**.

## Existing Phase-10 database compatibility (non-destructive)

Ran the additive migration against a **copy** of the real `data/orion.db` (the real
file was never modified): **6 satellites / 3369 telemetry rows / 6 investigations
intact**, **0 NULL** lifecycle rows, and the 3 new tables
(`simulation_sessions`, `simulation_failures`, `simulation_events`) created cleanly.

## Security verification

Simulation control is authenticated + RBAC-gated (analyst mutate → 403; director/
admin → allowed; verified). Input validated server-side (400 + field `details`);
SQL parameterized; failure/severity/speed/config validated against allowlists +
hard bounds. AI layers cannot mutate simulation (Assistant/Copilot control requests
refused; no `simulation_failures`/`simulation_sessions` writes). No secrets, raw
prompts, raw vectors, or hidden reasoning in events/audits. No destructive Reset;
STOP / clear-failures / config-reset preserve all history.
