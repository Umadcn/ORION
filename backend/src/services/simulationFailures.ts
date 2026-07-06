/**
 * Simulation failure catalog + deterministic telemetry-effect composition.
 *
 * This module is the single source of truth for:
 *   - the SIMULATABLE telemetry fields and their configurable shape,
 *   - the FAILURE CATALOG (derived from the deterministic anomaly rules +
 *     telemetry schema), and
 *   - the deterministic composition of multiple simultaneous failure effects.
 *
 * It is a PURE domain module (no DB, no time): everything is a function of the
 * telemetry profile, the tick counter, and the active-failure list, so it is
 * fully unit-testable and reproducible. The engine (simulationService) owns
 * persistence + scheduling; the anomaly engine (anomalyRules) owns detection.
 * Nothing here creates alerts or investigations.
 */
import type { AnomalyType, Severity } from '../types.js';

/** Canonical simulatable telemetry fields (a subset of the telemetry schema). */
export type TelemetryFieldKey =
  | 'battery_percent'
  | 'temperature_c'
  | 'power_consumption_w'
  | 'signal_strength_dbm'
  | 'altitude_km';

export interface TelemetryFieldMeta {
  key: TelemetryFieldKey;
  label: string;
  unit: string;
  /** Hard physical bounds enforced regardless of user config (safety clamp). */
  hardMin: number;
  hardMax: number;
  /** Convenience default baseline when the satellite has no better source. */
  defaultBaseline: number;
  defaultNoise: number;
}

export const TELEMETRY_FIELDS: TelemetryFieldMeta[] = [
  { key: 'battery_percent', label: 'Battery', unit: '%', hardMin: 0, hardMax: 100, defaultBaseline: 100, defaultNoise: 0.8 },
  { key: 'temperature_c', label: 'Temperature', unit: '°C', hardMin: -80, hardMax: 200, defaultBaseline: 22, defaultNoise: 1.5 },
  { key: 'power_consumption_w', label: 'Power', unit: 'W', hardMin: 0, hardMax: 3000, defaultBaseline: 600, defaultNoise: 15 },
  { key: 'signal_strength_dbm', label: 'Signal', unit: 'dBm', hardMin: -160, hardMax: -30, defaultBaseline: -95, defaultNoise: 1.2 },
  { key: 'altitude_km', label: 'Altitude', unit: 'km', hardMin: 0, hardMax: 500000, defaultBaseline: 550, defaultNoise: 0.4 },
];

const FIELD_META: Record<TelemetryFieldKey, TelemetryFieldMeta> = Object.fromEntries(
  TELEMETRY_FIELDS.map((f) => [f.key, f]),
) as Record<TelemetryFieldKey, TelemetryFieldMeta>;

/** Per-field user-configurable simulation shape. */
export interface FieldConfig {
  baseline: number;
  min: number;
  max: number;
  noise: number;
  /** Baseline drift per tick (usually 0). */
  drift: number;
}

export type TelemetryProfile = Record<TelemetryFieldKey, FieldConfig>;

// ---------- Failure catalog ----------

export type SimulationFailureType =
  // Legacy composite subsystem failures (kept for backward compatibility):
  | 'POWER_SYSTEM_FAILURE'
  | 'THERMAL_CONTROL_FAILURE'
  | 'COMMUNICATION_FAILURE'
  | 'ORBIT_DEVIATION'
  | 'BATTERY_DEGRADATION'
  // Anomaly-aligned atomic failures:
  | 'LOW_BATTERY'
  | 'ABNORMAL_POWER_CONSUMPTION'
  | 'HIGH_TEMPERATURE'
  | 'COMMUNICATION_LOSS';

export type FailureOnset = 'IMMEDIATE' | 'GRADUAL';
export type FailureRecovery = 'IMMEDIATE' | 'LINEAR' | 'GRADUAL';
export type FailureState = 'ACTIVE' | 'EXPIRED' | 'REMOVED';

/** One field the failure pushes: direction (+1 rises / -1 falls) and per-tick rate. */
interface FieldEffect {
  field: TelemetryFieldKey;
  direction: 1 | -1;
  ratePerTick: number;
  /** Maximum absolute displacement from baseline (bounds runaway effects). */
  maxMagnitude: number;
}

export interface FailureDefinition {
  failureType: SimulationFailureType;
  displayName: string;
  description: string;
  affectedTelemetryFields: TelemetryFieldKey[];
  supportedSeverityLevels: Severity[];
  defaultSeverity: Severity;
  supportsDuration: boolean;
  supportsGradualOnset: boolean;
  supportsManualRemoval: boolean;
  anomalyRulesTriggered: AnomalyType[];
  expectedAlertTypes: AnomalyType[];
  /** Higher precedence wins when two active failures target the same field. */
  precedence: number;
  effects: FieldEffect[];
}

const ALL_SEV: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const FAILURE_CATALOG: FailureDefinition[] = [
  {
    failureType: 'POWER_SYSTEM_FAILURE',
    displayName: 'Payload Power Subsystem Failure',
    description:
      'Composite power-subsystem fault: the battery drains while power draw climbs, so LOW_BATTERY and ABNORMAL_POWER_CONSUMPTION cross their thresholds together.',
    affectedTelemetryFields: ['battery_percent', 'power_consumption_w', 'temperature_c'],
    supportedSeverityLevels: ALL_SEV,
    // MEDIUM by default + tuned rates so battery and power cross their thresholds
    // together (a genuine two-anomaly case → PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION).
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['LOW_BATTERY', 'ABNORMAL_POWER_CONSUMPTION'],
    expectedAlertTypes: ['LOW_BATTERY', 'ABNORMAL_POWER_CONSUMPTION'],
    precedence: 50,
    effects: [
      { field: 'battery_percent', direction: -1, ratePerTick: 11, maxMagnitude: 100 },
      { field: 'power_consumption_w', direction: 1, ratePerTick: 40, maxMagnitude: 1000 },
      { field: 'temperature_c', direction: 1, ratePerTick: 0.8, maxMagnitude: 25 },
    ],
  },
  {
    failureType: 'THERMAL_CONTROL_FAILURE',
    displayName: 'Thermal Control Failure',
    description: 'Thermal regulation degrades and internal temperature rises until HIGH_TEMPERATURE triggers.',
    affectedTelemetryFields: ['temperature_c'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['HIGH_TEMPERATURE'],
    expectedAlertTypes: ['HIGH_TEMPERATURE'],
    precedence: 40,
    effects: [{ field: 'temperature_c', direction: 1, ratePerTick: 4.0, maxMagnitude: 120 }],
  },
  {
    failureType: 'COMMUNICATION_FAILURE',
    displayName: 'Communication Subsystem Failure',
    description: 'Downlink signal strength degrades until COMMUNICATION_LOSS triggers.',
    affectedTelemetryFields: ['signal_strength_dbm'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['COMMUNICATION_LOSS'],
    expectedAlertTypes: ['COMMUNICATION_LOSS'],
    precedence: 40,
    effects: [{ field: 'signal_strength_dbm', direction: -1, ratePerTick: 3.0, maxMagnitude: 60 }],
  },
  {
    failureType: 'ORBIT_DEVIATION',
    displayName: 'Orbit Deviation',
    description: 'Altitude departs from the nominal baseline until ORBIT_DEVIATION triggers.',
    affectedTelemetryFields: ['altitude_km'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['ORBIT_DEVIATION'],
    expectedAlertTypes: ['ORBIT_DEVIATION'],
    precedence: 40,
    effects: [{ field: 'altitude_km', direction: 1, ratePerTick: 4.0, maxMagnitude: 400 }],
  },
  {
    failureType: 'BATTERY_DEGRADATION',
    displayName: 'Battery Degradation',
    description: 'Progressive battery capacity loss; a slower drain than a power fault, eventually crossing LOW_BATTERY.',
    affectedTelemetryFields: ['battery_percent'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['LOW_BATTERY'],
    expectedAlertTypes: ['LOW_BATTERY'],
    precedence: 30,
    effects: [{ field: 'battery_percent', direction: -1, ratePerTick: 9, maxMagnitude: 100 }],
  },
  {
    failureType: 'LOW_BATTERY',
    displayName: 'Low Battery',
    description: 'Direct battery drain until LOW_BATTERY triggers.',
    affectedTelemetryFields: ['battery_percent'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['LOW_BATTERY'],
    expectedAlertTypes: ['LOW_BATTERY'],
    precedence: 45,
    effects: [{ field: 'battery_percent', direction: -1, ratePerTick: 11, maxMagnitude: 100 }],
  },
  {
    failureType: 'ABNORMAL_POWER_CONSUMPTION',
    displayName: 'Abnormal Power Consumption',
    description: 'Power draw climbs until ABNORMAL_POWER_CONSUMPTION triggers.',
    affectedTelemetryFields: ['power_consumption_w'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['ABNORMAL_POWER_CONSUMPTION'],
    expectedAlertTypes: ['ABNORMAL_POWER_CONSUMPTION'],
    precedence: 45,
    effects: [{ field: 'power_consumption_w', direction: 1, ratePerTick: 45, maxMagnitude: 1200 }],
  },
  {
    failureType: 'HIGH_TEMPERATURE',
    displayName: 'High Temperature',
    description: 'Internal temperature rises until HIGH_TEMPERATURE triggers.',
    affectedTelemetryFields: ['temperature_c'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['HIGH_TEMPERATURE'],
    expectedAlertTypes: ['HIGH_TEMPERATURE'],
    precedence: 45,
    effects: [{ field: 'temperature_c', direction: 1, ratePerTick: 4.5, maxMagnitude: 120 }],
  },
  {
    failureType: 'COMMUNICATION_LOSS',
    displayName: 'Communication Loss',
    description: 'Signal strength degrades until COMMUNICATION_LOSS triggers.',
    affectedTelemetryFields: ['signal_strength_dbm'],
    supportedSeverityLevels: ALL_SEV,
    defaultSeverity: 'MEDIUM',
    supportsDuration: true,
    supportsGradualOnset: true,
    supportsManualRemoval: true,
    anomalyRulesTriggered: ['COMMUNICATION_LOSS'],
    expectedAlertTypes: ['COMMUNICATION_LOSS'],
    precedence: 45,
    effects: [{ field: 'signal_strength_dbm', direction: -1, ratePerTick: 3.5, maxMagnitude: 70 }],
  },
];

const CATALOG_BY_TYPE: Record<string, FailureDefinition> = Object.fromEntries(
  FAILURE_CATALOG.map((d) => [d.failureType, d]),
);

export function getFailureDefinition(type: string): FailureDefinition | undefined {
  return CATALOG_BY_TYPE[type];
}
export function isKnownFailureType(type: string): type is SimulationFailureType {
  return type in CATALOG_BY_TYPE;
}

export function severityMultiplier(sev: Severity): number {
  switch (sev) {
    case 'LOW': return 0.6;
    case 'MEDIUM': return 1.0;
    case 'HIGH': return 1.6;
    case 'CRITICAL': return 2.4;
    default: return 1.0;
  }
}

// ---------- Telemetry profile helpers ----------

const DEFAULT_ONSET_TICKS = 4;
const DEFAULT_RECOVERY_TICKS = 8;

/** Build a safe default per-field config for a satellite baseline. */
export function defaultProfile(base: {
  battery?: number; temperature?: number; power?: number; signal?: number; altitude?: number;
}): TelemetryProfile {
  const mk = (key: TelemetryFieldKey, baseline: number): FieldConfig => {
    const meta = FIELD_META[key];
    return { baseline, min: meta.hardMin, max: meta.hardMax, noise: meta.defaultNoise, drift: 0 };
  };
  return {
    battery_percent: mk('battery_percent', clampField('battery_percent', base.battery ?? 100)),
    temperature_c: mk('temperature_c', clampField('temperature_c', base.temperature ?? 22)),
    power_consumption_w: mk('power_consumption_w', clampField('power_consumption_w', base.power ?? 600)),
    signal_strength_dbm: mk('signal_strength_dbm', clampField('signal_strength_dbm', base.signal ?? -95)),
    altitude_km: mk('altitude_km', clampField('altitude_km', base.altitude ?? 550)),
  };
}

export function clampField(key: TelemetryFieldKey, value: number): number {
  const meta = FIELD_META[key];
  return Math.max(meta.hardMin, Math.min(meta.hardMax, value));
}

/** Validate + normalize a partial per-field config against hard bounds. */
export function normalizeFieldConfig(key: TelemetryFieldKey, input: Partial<FieldConfig>, current: FieldConfig): FieldConfig {
  const meta = FIELD_META[key];
  const num = (v: unknown, def: number) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? def : Number(v));
  let min = Math.max(meta.hardMin, num(input.min, current.min));
  let max = Math.min(meta.hardMax, num(input.max, current.max));
  if (min > max) { const t = min; min = max; max = t; }
  const baseline = Math.max(min, Math.min(max, num(input.baseline, current.baseline)));
  const noise = Math.max(0, Math.min((max - min) || meta.defaultNoise, num(input.noise, current.noise)));
  const drift = Math.max(-50, Math.min(50, num(input.drift, current.drift)));
  return { baseline, min, max, noise, drift };
}

// ---------- Deterministic composition ----------

export interface ActiveFailureRuntime {
  id: string;
  failureType: SimulationFailureType;
  severity: Severity;
  onset: FailureOnset;
  recovery: FailureRecovery;
  onsetTicks: number;
  durationTicks: number | null;
  injectedAtTick: number;
  state: FailureState;
  expiredAtTick: number | null;
}

/** Deterministic nominal wobble (matches the historic look). */
function wobble(amp: number, phase: number, seed: number): number {
  return amp * Math.sin((phase + seed) * 0.35);
}

/** Effective failure "progress" in ticks given onset ramping. */
function effectiveProgress(n: number, onset: FailureOnset, onsetTicks: number): number {
  if (n <= 0) return 0;
  if (onset === 'IMMEDIATE' || onsetTicks <= 0) return n;
  // GRADUAL: quadratic ramp until onsetTicks, then linear with a half-onset offset.
  if (n < onsetTicks) return (n * n) / (2 * onsetTicks);
  return n - onsetTicks / 2;
}

/** Recovery multiplier (1 → full effect, 0 → recovered) for an expired failure. */
function recoveryFactor(ticksSinceExpiry: number, recovery: FailureRecovery): number {
  if (recovery === 'IMMEDIATE') return 0;
  const span = DEFAULT_RECOVERY_TICKS;
  if (ticksSinceExpiry >= span) return 0;
  const linear = 1 - ticksSinceExpiry / span;
  if (recovery === 'LINEAR') return linear;
  // GRADUAL: ease-out.
  return linear * linear;
}

/** Signed displacement a single failure applies to one field at the current tick. */
export function failureFieldDelta(
  f: ActiveFailureRuntime,
  field: TelemetryFieldKey,
  currentTick: number,
): number {
  if (f.state === 'REMOVED') return 0;
  const def = getFailureDefinition(f.failureType);
  if (!def) return 0;
  const effect = def.effects.find((e) => e.field === field);
  if (!effect) return 0;

  const n = currentTick - f.injectedAtTick;
  if (n < 0) return 0;

  const sm = severityMultiplier(f.severity);

  if (f.state === 'EXPIRED' && f.expiredAtTick != null) {
    const atExpiry = effectiveProgress(f.expiredAtTick - f.injectedAtTick, f.onset, f.onsetTicks);
    const magAtExpiry = Math.min(effect.maxMagnitude, effect.ratePerTick * sm * atExpiry);
    const rf = recoveryFactor(currentTick - f.expiredAtTick, f.recovery);
    return effect.direction * magAtExpiry * rf;
  }

  const p = effectiveProgress(n, f.onset, f.onsetTicks);
  const mag = Math.min(effect.maxMagnitude, effect.ratePerTick * sm * p);
  return effect.direction * mag;
}

export interface ComposedSample {
  temperature_c: number;
  battery_percent: number;
  signal_strength_dbm: number;
  power_consumption_w: number;
  altitude_km: number;
  velocity_kms: number;
  latitude: number;
  longitude: number;
}

export interface FieldBreakdown {
  field: TelemetryFieldKey;
  baseline: number;
  generated: number;      // baseline + drift + noise (no failure)
  failureDelta: number;   // net delta from the winning failure
  emitted: number;        // final clamped value
  winningFailureId: string | null;
}

/**
 * Compose the emitted telemetry sample from the profile + active failures.
 *
 * CONFLICT RESOLUTION (deterministic): when multiple active/expired failures
 * affect the SAME field, the failure with the highest precedence wins (ties
 * broken by earliest injection tick, then failure id). Effects on DISJOINT
 * fields all apply. There is no reliance on object/iteration order.
 */
export function composeTelemetry(
  profile: TelemetryProfile,
  phase: number,
  currentTick: number,
  failures: ActiveFailureRuntime[],
  orbit: { velocity: number; latitude: number; longitude: number },
): { sample: ComposedSample; breakdown: FieldBreakdown[] } {
  const relevant = failures.filter((f) => f.state !== 'REMOVED');

  const breakdown: FieldBreakdown[] = [];
  const emittedByField = {} as Record<TelemetryFieldKey, number>;

  for (const key of Object.keys(profile) as TelemetryFieldKey[]) {
    const cfg = profile[key];
    const generated = cfg.baseline + cfg.drift * phase + wobble(cfg.noise, phase, seedForField(key));

    // Winning failure for this field (deterministic ordering).
    const candidates = relevant
      .filter((f) => {
        const def = getFailureDefinition(f.failureType);
        return def?.effects.some((e) => e.field === key) && Math.abs(failureFieldDelta(f, key, currentTick)) > 1e-9;
      })
      .sort((a, b) => {
        const pa = getFailureDefinition(a.failureType)?.precedence ?? 0;
        const pb = getFailureDefinition(b.failureType)?.precedence ?? 0;
        if (pb !== pa) return pb - pa;
        if (a.injectedAtTick !== b.injectedAtTick) return a.injectedAtTick - b.injectedAtTick;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

    const winner = candidates[0] ?? null;
    const failureDelta = winner ? failureFieldDelta(winner, key, currentTick) : 0;
    const emitted = clampField(key, round(generated + failureDelta));
    emittedByField[key] = emitted;
    breakdown.push({ field: key, baseline: cfg.baseline, generated: round(generated), failureDelta: round(failureDelta), emitted, winningFailureId: winner?.id ?? null });
  }

  const sample: ComposedSample = {
    battery_percent: emittedByField.battery_percent,
    temperature_c: emittedByField.temperature_c,
    power_consumption_w: emittedByField.power_consumption_w,
    signal_strength_dbm: emittedByField.signal_strength_dbm,
    altitude_km: emittedByField.altitude_km,
    velocity_kms: round(orbit.velocity + wobble(0.005, phase, 5)),
    latitude: round(orbit.latitude + wobble(0.05, phase, 6)),
    longitude: round(orbit.longitude + wobble(0.05, phase, 7)),
  };
  return { sample, breakdown };
}

function seedForField(key: TelemetryFieldKey): number {
  switch (key) {
    case 'temperature_c': return 0;
    case 'battery_percent': return 1;
    case 'signal_strength_dbm': return 2;
    case 'power_consumption_w': return 3;
    case 'altitude_km': return 4;
    default: return 0;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export const SIMULATION_DEFAULTS = {
  onsetTicks: DEFAULT_ONSET_TICKS,
  recoveryTicks: DEFAULT_RECOVERY_TICKS,
  minTickIntervalMs: 250,
  maxTickIntervalMs: 60000,
  baseTickIntervalMs: 2000,
  allowedSpeeds: [0.5, 1, 2, 5, 10] as number[],
  maxSamplesPerTick: 10,
};

/** Serialize the catalog for the API/frontend (no functions). */
export function catalogForApi(): Array<Omit<FailureDefinition, 'effects'> & { affectedTelemetryFields: TelemetryFieldKey[] }> {
  return FAILURE_CATALOG.map(({ effects: _effects, ...rest }) => ({ ...rest }));
}
