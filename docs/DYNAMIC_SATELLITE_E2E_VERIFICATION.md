# Dynamic Satellite — End-to-End Verification

All results below were executed this session (offline / deterministic-fallback).

## Automated tests

- Backend `tests/dynamicSatellite.test.ts` — **18 tests** covering: manual creation
  (201) + persistence; duplicate id (409); duplicate NORAD (409); invalid enums /
  numeric bounds / id format (400 with `details`); manually-provided orbit state;
  auth (401) + RBAC (analyst create 403, Director create, Admin archive/reactivate,
  analyst/Director archive 403); mass-assignment protection (id/status/health not
  writable); dashboard count; global search/list; details honest no-telemetry +
  orbit-unavailable + zero alerts/investigations; archive exclusion + `includeArchived`;
  seed idempotency with a manual satellite; dynamic simulation selection + telemetry
  association; **cross-satellite telemetry isolation**; anomaly → alert →
  investigation → six agents → deterministic RCA → human approve/resolve → report;
  historical search; Copilot `getSatellite` dynamic; AI Assistant entity resolution +
  multi-turn continuity + **write-request refusal**; no rogue AI mutation.
- Frontend `src/lib/satellite.test.ts` — **7 tests**: no-telemetry never shows a
  fabricated health %, orbit-unavailable never shows a fabricated altitude, sim
  eligibility, archived/manual flags, and backward-compat for legacy rows.
- Full suites: **Backend 402/402** (27 files) · **Frontend 43/43** (6 files) · both
  typecheck clean · frontend production build ✅.

## Runtime E2E over real HTTP (throwaway DB)

`SAT-NEW-001` (mission "Earth Observation", NORAD 48274, no orbital data):

1. `POST /api/satellites` → **201**.
2. Dashboard summary includes it immediately (`dashboard_has_new=true`).
3. Global list/search finds it (`search_finds_new=true`).
4. Details: `has_telemetry=false`, `telemetry_state=NO_TELEMETRY`,
   `orbit_data_state=UNAVAILABLE`, `alerts=0`, `investigations=0`, `status=UNKNOWN`
   — **no fabricated data**.
5. `POST /api/satellites/:id/simulate` → **200**; telemetry begins flowing only now
   (`telemetry_after_sim` > 0).
6. Copilot "Tell me about SAT-NEW-001." → calls **`getSatellite`** (dynamic).
7. Assistant "Tell me about SAT-NEW-001." → resolves `SAT-NEW-001`; follow-up "Does it
   have telemetry?" preserves the entity (**continuity**); "Start the simulation for
   SAT-NEW-001." → **REFUSED** (AI read-only; no mutation).
8. **Restart survival**: a second backend process against the same DB file still finds
   `SAT-NEW-001` (`origin=MANUAL`, `lifecycle=ACTIVE`, telemetry persisted).

## Existing Phase-10 database compatibility (non-destructive)

Ran the additive migration against a **copy** of the real `data/orion.db` (the real
file was never modified): 5 seeded satellites intact, backfilled `origin=SEED`,
`lifecycle_state=ACTIVE`, `orbit_data_state=MANUALLY_PROVIDED`,
`data_source_mode=SIMULATED`; **0 NULL** lifecycle rows after migration.

## Security verification

Create/edit/archive/reactivate/simulate are authenticated human actions gated by
RBAC (analyst blocked with 403; verified). Input validated server-side (400 with
field `details`); SQL parameterized; only whitelisted fields writable (id/status/
health not reassignable via PATCH); NORAD + id uniqueness enforced; archived
satellites excluded by default. AI layers cannot mutate satellites (Assistant write
request refused; lifecycle unchanged). No secrets/raw vectors exposed.
