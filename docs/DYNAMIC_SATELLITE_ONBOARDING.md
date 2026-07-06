# Dynamic Satellite Onboarding

PROJECT ORION supports manually registering new satellites at runtime through the
authenticated UI/API. A manually-registered satellite is a **first-class persisted
entity** that flows through every applicable module — with **no fabricated data**:
it starts with no telemetry, no alerts, no investigations, and honest
orbit/telemetry "unavailable" states. Those capabilities appear only as the
satellite receives real or explicitly-simulated telemetry and progresses through
the existing pipeline.

## Domain model (persisted on the `satellites` table)

Legacy columns (kept, NOT-NULL preserved for backward compatibility):
`id, name, norad_id, mission, orbit_type, altitude, velocity, latitude, longitude,
health_score, status`. Additive dynamic-onboarding columns (nullable / backfilled):
`display_name, description, norad_catalog_id, tle_line1, tle_line2, inclination,
orbital_period_min, launch_date, orbit_data_state, data_source_mode, sim_eligible,
lifecycle_state, origin, created_by, created_at, updated_at, archived_at`.

- **REQUIRED**: `id` (stable identifier, `^[A-Z0-9][A-Z0-9_-]{1,31}$`), `mission`.
- **OPTIONAL**: name, description, orbit_type, norad_catalog_id, TLE lines, altitude,
  velocity, inclination, orbital_period_min, latitude, longitude, launch_date, sim_eligible.
- **DERIVED**: `orbit_data_state` (TLE or altitude → `MANUALLY_PROVIDED`, else
  `UNAVAILABLE`), `data_source_mode` (`NO_TELEMETRY` at creation → `SIMULATED` when
  simulation starts), `status` (`UNKNOWN` until telemetry), `health_score` (0 until
  telemetry), `origin=MANUAL`, `lifecycle_state=ACTIVE`, timestamps.
- **EXTERNALLY_RESOLVED**: real TLE for an arbitrary NORAD id is not auto-fetched
  (honest `UNAVAILABLE`); the existing CelesTrak feed remains for the seeded fleet.

Orbital parameters are never fabricated. A satellite without orbit data persists
successfully and shows **ORBIT DATA UNAVAILABLE**.

## APIs

| Method | Path | RBAC | Notes |
|--------|------|------|-------|
| GET | `/api/satellites?includeArchived=` | any authed | archived excluded by default |
| GET | `/api/satellites/:id` | any authed | + honest orbit/telemetry states + relations |
| GET | `/api/satellites/:id/telemetry` | any authed | empty array when none |
| POST | `/api/satellites` | Director/Admin | create; 201 / 400 (details) / 409 (dup id or NORAD) |
| PATCH | `/api/satellites/:id` | Director/Admin | edit metadata (whitelist; mass-assignment safe) |
| POST | `/api/satellites/:id/archive` | Admin | decommission (no hard delete); stops its simulation |
| POST | `/api/satellites/:id/reactivate` | Admin | reactivate |
| POST | `/api/satellites/:id/simulate` | Director/Admin | explicitly start simulation for this satellite |
| POST | `/api/satellites/:id/simulate/stop` | Director/Admin | stop simulating this satellite |

## RBAC matrix

| Action | Analyst | Director | Admin |
|--------|:------:|:-------:|:-----:|
| View satellites/details/telemetry | ✅ | ✅ | ✅ |
| Create / edit satellite | ❌ | ✅ | ✅ |
| Start/stop simulation for a satellite | ❌ | ✅ | ✅ |
| Archive / reactivate | ❌ | ❌ | ✅ |

## Persistence + seed idempotency

Reuses the existing `satellites` table; the migration is additive and idempotent
(`addColumnIfMissing` + a `COALESCE` backfill for existing rows). Seed logic only
inserts the demo fleet when the table is **empty** — it never overwrites, deletes,
archives, or duplicates a manually-created satellite. Manually-created satellites
survive browser refresh, logout/login, and backend/frontend/application restart
(verified). Existing Phase-10 databases migrate cleanly (5 seeded satellites intact,
backfilled `origin=SEED`).

## Dynamic simulation

The simulation engine maintains an explicit **sim-target set**. The seeded fleet is
registered at init (backward-compatible demo behavior + tests). A manually-registered
satellite is **not** auto-simulated — an authorized user explicitly starts it, which
derives a telemetry profile from persisted metadata (never copied from another
satellite) and flips `data_source_mode` to `SIMULATED`. The tick loop iterates the
sim-target set; anomaly windows are keyed by satellite identity (no cross-satellite
state leakage). Duplicate targets are prevented; start/stop/status are supported.

## AI (read-only)

Satellite-id recognition is **dynamic**: the Copilot and AI Assistant resolve any
persisted satellite id (e.g. `SAT-NEW-001`), not just the `ORION-N` pattern
(`findSatelliteIdInText`). AI systems (Copilot, Assistant, Planner, Critic, the six
operational agents, RAG/generation, provider layer) can **read** a dynamic satellite
but can **never** create/edit/archive/reactivate/control it — those are explicit
human actions only.
