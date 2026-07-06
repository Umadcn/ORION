# Simulation Session Lifecycle

A `SimulationSession` belongs to exactly one persisted satellite and owns its
telemetry profile, speed, tick counter, failures, and event log. State is
persisted (`simulation_sessions`, `simulation_failures`, `simulation_events`) so it
survives page refresh and backend restart. Runtime timer handles are never
persisted.

## States

```
CREATED ──start──▶ RUNNING ──pause──▶ PAUSED ──resume──▶ RUNNING
   │                  │                                    │
   │                  └────────────── stop ────────────────┤
   └──────── start ───┘                                     ▼
                                                          STOPPED
RUNNING ──(backend restart)──▶ INTERRUPTED ──resume/start──▶ RUNNING
```

| Status | Meaning | Emits telemetry? |
|---|---|:--:|
| `CREATED` | Configured, not started | No |
| `RUNNING` | Actively generating simulated telemetry | Yes |
| `PAUSED` | Suspended; session + failures preserved | No |
| `STOPPED` | Ended by operator; history preserved | No |
| `INTERRUPTED` | Was RUNNING at a backend restart | No (until explicitly resumed) |
| `FAILED` | Reserved for engine-level failure | No |

Only one non-terminal (`CREATED`/`RUNNING`/`PAUSED`/`INTERRUPTED`) session may
exist per satellite; `createSession` is idempotent and reuses it.

### Transition guards (enforced server-side)

- `start`: from `CREATED`, `STOPPED`, `INTERRUPTED` (also re-validates satellite eligibility).
- `pause`: from `RUNNING` only.
- `resume`: from `PAUSED` or `INTERRUPTED`.
- `stop`: from `RUNNING`/`PAUSED` (idempotent from `STOPPED`).

Invalid transitions return `409 CONFLICT`.

## Speed

`simulation_speed ∈ {0.5, 1, 2, 5, 10}`. A single global ticker fires at the base
interval; each RUNNING session emits `floor(speed)` samples per tick (a per-session
accumulator handles `0.5×`), capped at 10 samples/tick — telemetry generation is
bounded server-side. In-memory (test) databases never start the background ticker;
tests drive emission deterministically via `tickOnce()`.

## Restart behavior (no silent resume)

On process start, `initSimulation()` calls `recoverAfterRestart()`, which marks
every `RUNNING` session `INTERRUPTED`. **No session silently resumes and no
duplicate worker starts.** An operator must explicitly resume/start. Telemetry
history, failures (as DB rows), alerts, investigations and events all remain
visible.

## Events

Bounded, sanitized event log per session (`simulation_events`): `SESSION_CREATED`,
`SIMULATION_STARTED/PAUSED/RESUMED/STOPPED`, `SPEED_CHANGED`,
`TELEMETRY_CONFIG_CHANGED`, `FAILURE_INJECTED/REMOVED/EXPIRED`, `FAILURES_CLEARED`,
`ANOMALY_DETECTED`, `ALERT_CREATED`, `INVESTIGATION_CREATED/ANALYZED`. Each row has
timestamp, session id, satellite id, event type, a bounded summary and the actor.
No secrets, raw prompts, or hidden reasoning.
