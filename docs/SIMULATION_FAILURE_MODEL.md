# Simulation Failure Model

Defined in `backend/src/services/simulationFailures.ts` — a pure, unit-tested
domain module. The failure catalog is derived from the deterministic anomaly
rules + telemetry schema and is served to the frontend dynamically
(`GET /api/simulation/failures`); the frontend never hardcodes it.

## Simulatable telemetry fields

`battery_percent (%)`, `temperature_c (°C)`, `power_consumption_w (W)`,
`signal_strength_dbm (dBm)`, `altitude_km (km)`. Each field has a user-configurable
shape: `baseline`, `min`, `max`, `noise`, `drift`, clamped to hard physical bounds.
Nominal per-tick value = `baseline + drift*tick + noise*wobble(tick)`.

## Failure catalog

| failureType | Affected fields | Triggers anomaly | Precedence | Default severity |
|---|---|---|:--:|:--:|
| POWER_SYSTEM_FAILURE | battery, power, temperature | LOW_BATTERY + ABNORMAL_POWER_CONSUMPTION | 50 | MEDIUM |
| LOW_BATTERY | battery | LOW_BATTERY | 45 | MEDIUM |
| ABNORMAL_POWER_CONSUMPTION | power | ABNORMAL_POWER_CONSUMPTION | 45 | MEDIUM |
| HIGH_TEMPERATURE | temperature | HIGH_TEMPERATURE | 45 | MEDIUM |
| COMMUNICATION_LOSS | signal | COMMUNICATION_LOSS | 45 | MEDIUM |
| THERMAL_CONTROL_FAILURE | temperature | HIGH_TEMPERATURE | 40 | MEDIUM |
| COMMUNICATION_FAILURE | signal | COMMUNICATION_LOSS | 40 | MEDIUM |
| ORBIT_DEVIATION | altitude | ORBIT_DEVIATION | 40 | MEDIUM |
| BATTERY_DEGRADATION | battery | LOW_BATTERY | 30 | MEDIUM |

Each definition also declares `supportedSeverityLevels`, `supportsDuration`,
`supportsGradualOnset`, `supportsManualRemoval`, and `expectedAlertTypes`.

## Effect trajectory

For a failure active `n` ticks, displacement of a field =
`direction × ratePerTick × severityMultiplier × effectiveProgress(n)`, capped by a
per-field `maxMagnitude` and clamped to hard bounds.

- **Severity multiplier**: LOW 0.6 · MEDIUM 1.0 · HIGH 1.6 · CRITICAL 2.4.
- **Onset**: `IMMEDIATE` → full rate from tick 1; `GRADUAL` → quadratic ramp over
  `onsetTicks` (default 4).

## Multi-failure composition (deterministic conflict resolution)

`composeTelemetry()` composes all active/expired failures every tick:

1. Failures on **disjoint** fields all apply.
2. When multiple failures target the **same** field, the one with the **highest
   `precedence`** wins (ties broken by earliest `injectedAtTick`, then failure
   `id`). Effects are **not** summed and never depend on object/iteration order —
   so results are fully reproducible.

Example: `POWER_SYSTEM_FAILURE` (50) + `LOW_BATTERY` (45) → the battery follows
POWER_SYSTEM_FAILURE alone; a co-active `HIGH_TEMPERATURE` still drives temperature
independently.

## Duration, expiry and recovery

A failure with `durationTicks = D` becomes `EXPIRED` when `n ≥ D` (an
`FAILURE_EXPIRED` event is logged). After expiry its effect decays toward the
baseline per `recovery`:

- `IMMEDIATE` → effect drops to 0 at once.
- `LINEAR` → decays linearly over the recovery window (8 ticks).
- `GRADUAL` → ease-out decay over the recovery window.

Expiry/recovery never deletes telemetry history, alerts, or investigations.

## Failure states

`ACTIVE` → applying · `EXPIRED` → duration elapsed, recovering · `REMOVED` → cleared
by an operator (kept in the DB as history, no longer applied). "Clear all" marks
every `ACTIVE`/`EXPIRED` failure `REMOVED`; it never deletes rows or downstream data.
