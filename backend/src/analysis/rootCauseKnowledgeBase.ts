/**
 * Root Cause knowledge base.
 *
 * A transparent, hand-authored mapping from observed anomalies (and contextual
 * factors) to candidate root causes with numeric weights. This is the "brain"
 * of the deterministic Root Cause Analysis engine — no LLM, no randomness.
 * The same evidence always yields the same weights, and every weight is visible
 * in the scoring breakdown shown to the evaluator.
 */
import type { AnomalyType, RootCause } from '../types.js';

export interface WeightRule {
  root_cause: RootCause;
  weight: number;
  reason: string;
}

/** Anomaly → candidate root causes with weights. */
export const ANOMALY_WEIGHTS: Record<AnomalyType, WeightRule[]> = {
  LOW_BATTERY: [
    { root_cause: 'BATTERY_DEGRADATION', weight: 0.35, reason: 'Low battery is a primary symptom of battery cell degradation' },
    { root_cause: 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION', weight: 0.2, reason: 'Excess payload draw can drain the battery faster than charging' },
  ],
  ABNORMAL_POWER_CONSUMPTION: [
    { root_cause: 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION', weight: 0.45, reason: 'Sustained over-consumption strongly indicates a payload power fault' },
  ],
  HIGH_TEMPERATURE: [
    { root_cause: 'THERMAL_CONTROL_FAILURE', weight: 0.35, reason: 'High temperature is the defining symptom of thermal control loss' },
    { root_cause: 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION', weight: 0.15, reason: 'Excess power dissipation raises component temperature' },
  ],
  COMMUNICATION_LOSS: [
    { root_cause: 'COMMUNICATION_SUBSYSTEM_FAILURE', weight: 0.5, reason: 'Signal loss points directly to the communication subsystem' },
  ],
  ORBIT_DEVIATION: [
    { root_cause: 'ORBITAL_PERTURBATION', weight: 0.55, reason: 'Altitude deviation indicates an orbital perturbation event' },
  ],
};

/** Contextual adjustments applied by the scoring engine. */
export const CONTEXT_WEIGHTS = {
  severeGeomagnetic: { root_cause: 'SPACE_WEATHER_INTERFERENCE' as RootCause, weight: 0.4, reason: 'Severe geomagnetic storm can interfere with satellite subsystems' },
  quietGeomagneticPenalty: { root_cause: 'SPACE_WEATHER_INTERFERENCE' as RootCause, weight: -0.25, reason: 'Quiet space weather makes space-weather interference unlikely' },
  orbitDeviationConfirmed: { root_cause: 'ORBITAL_PERTURBATION' as RootCause, weight: 0.25, reason: 'Orbit intelligence confirms measurable orbital deviation' },
  orbitNominalPenalty: { root_cause: 'ORBITAL_PERTURBATION' as RootCause, weight: -0.2, reason: 'Orbit intelligence reports nominal orbit — perturbation unlikely' },
};

/** Human-friendly labels + advisory recommendations per root cause. */
export const ROOT_CAUSE_INFO: Record<
  RootCause,
  { label: string; recommendations: { action: string; rationale: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }[] }
> = {
  PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION: {
    label: 'Payload Power Subsystem Malfunction',
    recommendations: [
      { action: 'Disable non-essential payloads', rationale: 'Reduce load on the failing power subsystem and slow battery drain', priority: 'HIGH' },
      { action: 'Enable power-saving mode', rationale: 'Preserve remaining battery capacity while the fault is investigated', priority: 'HIGH' },
      { action: 'Inspect payload power subsystem telemetry', rationale: 'Confirm the fault location and assess whether isolation is possible', priority: 'MEDIUM' },
      { action: 'Continue enhanced telemetry monitoring', rationale: 'Detect further degradation and validate the effect of mitigations', priority: 'MEDIUM' },
    ],
  },
  BATTERY_DEGRADATION: {
    label: 'Battery Degradation',
    recommendations: [
      { action: 'Reduce discharge depth on affected battery bank', rationale: 'Slow further capacity loss in degraded cells', priority: 'HIGH' },
      { action: 'Schedule battery reconditioning cycle', rationale: 'Attempt to recover usable capacity if supported', priority: 'MEDIUM' },
      { action: 'Continue telemetry monitoring', rationale: 'Track degradation rate for end-of-life planning', priority: 'MEDIUM' },
    ],
  },
  THERMAL_CONTROL_FAILURE: {
    label: 'Thermal Control Failure',
    recommendations: [
      { action: 'Rotate spacecraft to reduce solar loading', rationale: 'Lower absorbed heat while thermal control is impaired', priority: 'HIGH' },
      { action: 'Power down heat-generating non-essential units', rationale: 'Reduce internal heat generation', priority: 'HIGH' },
      { action: 'Inspect radiator / louver telemetry', rationale: 'Determine whether thermal hardware has failed', priority: 'MEDIUM' },
    ],
  },
  COMMUNICATION_SUBSYSTEM_FAILURE: {
    label: 'Communication Subsystem Failure',
    recommendations: [
      { action: 'Switch to redundant transponder', rationale: 'Restore the downlink if a backup path exists', priority: 'HIGH' },
      { action: 'Re-point ground station antenna', rationale: 'Rule out ground-segment pointing as the cause', priority: 'MEDIUM' },
      { action: 'Continue telemetry monitoring', rationale: 'Confirm whether signal recovers with mitigation', priority: 'MEDIUM' },
    ],
  },
  SPACE_WEATHER_INTERFERENCE: {
    label: 'Space Weather Interference',
    recommendations: [
      { action: 'Enter safe mode until storm subsides', rationale: 'Protect sensitive electronics during elevated radiation', priority: 'HIGH' },
      { action: 'Correlate anomaly with NOAA space-weather timeline', rationale: 'Confirm the event aligns with geomagnetic activity', priority: 'MEDIUM' },
    ],
  },
  ORBITAL_PERTURBATION: {
    label: 'Orbital Perturbation',
    recommendations: [
      { action: 'Plan station-keeping maneuver', rationale: 'Correct altitude/position deviation', priority: 'HIGH' },
      { action: 'Recompute orbit from latest tracking data', rationale: 'Quantify the deviation before maneuvering', priority: 'MEDIUM' },
    ],
  },
  UNKNOWN_ANOMALY: {
    label: 'Unknown Anomaly',
    recommendations: [
      { action: 'Escalate to engineering team for manual review', rationale: 'Automated analysis was inconclusive', priority: 'HIGH' },
      { action: 'Continue enhanced telemetry monitoring', rationale: 'Gather more evidence to classify the anomaly', priority: 'MEDIUM' },
    ],
  },
};

export const ALL_ROOT_CAUSES: RootCause[] = [
  'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION',
  'BATTERY_DEGRADATION',
  'THERMAL_CONTROL_FAILURE',
  'COMMUNICATION_SUBSYSTEM_FAILURE',
  'SPACE_WEATHER_INTERFERENCE',
  'ORBITAL_PERTURBATION',
  'UNKNOWN_ANOMALY',
];
