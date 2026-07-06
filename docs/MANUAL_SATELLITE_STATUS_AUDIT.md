# Manual Satellite Status — Current-Architecture Audit

Reconnaissance performed before implementing manual status control. Read-only; no
code changed during this audit.

## 1. Where satellite status is stored

- `satellites` table — `backend/src/db.ts:53-65`. Two relevant columns:
  - `status TEXT NOT NULL` — HEALTHY | WARNING | ALERT | OFFLINE | UNKNOWN.
  - `health_score REAL NOT NULL` — 0–100.
- The `status` column is the **system-derived** status. It is written only by the
  simulation/pipeline via `updateSatelliteHealth(id, health, status)`
  (`backend/src/services/telemetryService.ts:53-59`).
- Manually-registered satellites are created with honest placeholders
  `health_score: 0, status: 'UNKNOWN'` (`satelliteService.ts:102`) until they
  receive telemetry.

## 2. Where status / health is derived (system-computed)

- **Single derivation point:** `simulationService.ts` — `statusFrom(health)`
  (health ≥ 80 → HEALTHY, ≥ 55 → WARNING, > 0 → ALERT, else OFFLINE) and the
  weighted `health_score` formula from telemetry thresholds. The result is
  persisted through `updateSatelliteHealth` on each tick.
- No other backend module independently *computes* status; everything else
  **reads** the stored `status` column.

## 3. Backend read surfaces that expose status

| Surface | File |
|---|---|
| List | `GET /api/satellites` → `listSatellites()` `api/satellites.ts:25` |
| Detail | `GET /api/satellites/:id` `api/satellites.ts:52` |
| Dashboard fleet counts + system health | `api/dashboard.ts:12-31` (`s.status === 'HEALTHY'`, `system_health`) |
| Orbit map | frontend consumes `api.satellites()` |
| Global search | frontend consumes `api.satellites()` |
| AI getSatellite tool | `copilot/tools/getSatellite.ts:34` returns `status` |
| AI Assistant status answer | `assistant/deterministicAssistant.ts:259` |

`getAllSatellites()` / `getSatellite(id)` (`telemetryService.ts:45-51`) are the
raw row accessors used both by the read APIs and by the simulation write path.

## 4. AI Assistant / Copilot

- `getSatellite` tool (`copilot/tools/getSatellite.ts`) returns
  `{ found, id, name, mission, orbit_type, status, health_score, altitude_km }`.
- Assistant `SATELLITE_STATUS` / `TELEMETRY_ANALYSIS` builder
  (`deterministicAssistant.ts:252-267`) turns that into a claim + status card.
- AI is **read-only**: no tool writes satellite state (verified by existing tests).

## 5. Frontend components that read/cache status

Polling-based (no WebSocket/SSE). Hook: `usePolling(fn, 3000)`
(`hooks/usePolling.ts`) with a manual `refetch()`.

| Component | Reads | File |
|---|---|---|
| Satellites list + cards | `s.status` badge/dot | `pages/SatellitesPage.tsx:47,53` |
| Satellite detail | `s.status` header badge | `pages/SatelliteDetailsPage.tsx:41` |
| Dashboard counts | `dashboardSummary().satellites` | `pages/DashboardPage.tsx` |
| Health donut | `s.status` filter | `components/SatelliteHealthDonut.tsx:8-10` |
| Orbit map markers + filter | `s.status` | `components/OrbitMap.tsx:12-34` |
| Global search subtitle | `s.status` | `components/GlobalSearch.tsx:44` |
| Status color helper | `statusColor()` / `healthBarColor()` | `lib/format.ts:53-72` |

Frontend `SatelliteStatus` type: `frontend/src/types.ts:19`. Satellite shape:
`types.ts:38-68`. API client satellite methods: `api/client.ts:110-120`. **No
frontend module recomputes status** — all read `s.status`, so overriding the
serialized `status` field on the backend propagates everywhere automatically.

## 6. Existing audit + migration patterns to follow

- Additive, idempotent migrations via `addColumnIfMissing(table, column, type)`
  (`db.ts:945-951`) with a `COALESCE`-based backfill (`db.ts:913-925`).
- Append-only event/audit tables already exist: `simulation_events`
  (`db.ts:871-881`), `assistant_executions`, `copilot_executions`,
  `llm_executions`. New status history will mirror `simulation_events`.

## 7. RBAC + error mapping

- `requireRole('MISSION_DIRECTOR','SYSTEM_ADMIN')` gates all satellite mutations
  (`api/satellites.ts`); analyst is read-only. `req.user` = JWT payload with
  `sub` + `role` (`auth/middleware.ts`).
- Domain errors → HTTP via `api/errors.ts` (`SatelliteValidationError` → 400,
  `SatelliteNotFoundError` → 404, `SatelliteConflictError` → 409).

## 8. Realtime

- No WebSocket/SSE. All pages poll every 3 s and expose `refetch()`. After a
  status change the frontend calls `refetch()` for immediate feedback; the 3 s
  poll keeps every other open page consistent. No new messaging system needed.

## Design implication (canonical model)

The stored `status` column **is** `derivedStatus` and must not be overwritten by
manual control. Manual override is stored in NEW additive columns
(`status_mode`, `manual_status`, `manual_status_reason`,
`manual_status_updated_at`, `manual_status_updated_by`). A single backend resolver
computes `effectiveStatus = mode === MANUAL ? manual_status : derivedStatus` and a
`serializeSatellite()` sets the serialized `status` field to `effectiveStatus`
(plus explicit `derived_status` / `effective_status` / mode fields), so all read
surfaces reflect the effective status through one code path.
