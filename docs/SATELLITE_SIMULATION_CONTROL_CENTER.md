# Satellite Simulation Control Center

A general-purpose, human-controlled satellite simulation environment. It replaces
the old static "Simulation & Demo Launcher" (predefined scenario cards, fixed
ORION-N targets, a PRIMARY scenario, and a destructive Reset). There is **no demo
concept** anywhere in the module.

## What a human operator can do

Select **any** active, simulation-eligible, persisted satellite (seeded or
manually onboarded), configure its initial simulated telemetry, and:

- **Start / Pause / Resume / Stop** the simulation (per satellite, isolated).
- **Change speed** (0.5× / 1× / 2× / 5× / 10×) while running.
- **Configure telemetry** per field: baseline, min, max, noise, drift.
- **Inject any supported failure** from the dynamic failure catalog, with
  severity, onset (immediate/gradual), recovery (immediate/linear/gradual) and
  optional bounded duration.
- **Inject multiple simultaneous failures**; **remove one** individually or
  **clear all** — without stopping the simulation.
- Observe **live telemetry**, **active failures**, **pipeline activity**
  (telemetry/alerts/investigations/ticks) and a **session event log**.

## Layout (`/simulation`)

Header → "Satellite Simulation Control Center" with a `SIMULATED` telemetry-source
badge. Left column: **Select Satellite** (searchable), **Satellite Summary**,
**Simulation Controls** (start/pause/resume/stop + speed), **Telemetry
Configuration** (per-field baseline/min/max/noise/drift + Restore baseline).
Right column: **Live Telemetry — <selected id>**, **Failure Catalog** (dynamic,
filterable cards — no PRIMARY, no fixed target), **Active Failures** (per-failure
remove + clear-all), **Pipeline Activity**, and **Event Log**.

## RBAC

| Capability | Analyst | Director | Admin |
|---|:--:|:--:|:--:|
| View satellites / status / telemetry / failures / events | ✅ | ✅ | ✅ |
| Create / start / pause / resume / stop session | ❌ | ✅ | ✅ |
| Change speed / telemetry config | ❌ | ✅ | ✅ |
| Inject / remove / clear failures | ❌ | ✅ | ✅ |

Enforced server-side (independent of the UI): view routes require only
authentication; mutations require `MISSION_DIRECTOR` or `SYSTEM_ADMIN`.

## Pipeline integration (no shortcuts)

```
SESSION → SIMULATED TELEMETRY → normal telemetry ingestion
        → EXISTING deterministic anomaly rules → persistence windows
        → alert creation → investigation → six operational agents
        → deterministic RCA → evidence → human review → report
```

The Control Center only **emits telemetry**. It never creates alerts or
investigations directly, never runs a second anomaly engine, and never fabricates
real telemetry — every value is explicitly labelled `SIMULATED`.

## Dynamic satellite onboarding compatibility

A satellite created through the authenticated onboarding UI/API appears in the
selector automatically if simulation-eligible — **no restart, no seed change, no
source-code change**. Verified with `SAT-NEW-001`.

## AI boundary

Mission Copilot, ORION AI Assistant, Planner, Critic, the six operational agents,
and the LLM/RAG layers are **read-only** with respect to simulation. They may read
simulation status/telemetry/failures/alerts/investigations but can never start,
pause, resume, stop, change speed, modify telemetry, or inject/remove/clear
failures. These control requests are classified `PROHIBITED` deterministically
(before any tool/workflow runs) and refused. See `ORION_AI_ASSISTANT_SECURITY.md`.

## Non-destructive operations

There is no Reset. STOP ends telemetry generation for one satellite only.
Removing/clearing failures and resetting telemetry configuration never delete
telemetry history, alerts, investigations, evidence, RCA, reports, or audits.
