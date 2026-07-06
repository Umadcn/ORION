/**
 * Anomaly detection rules and configurable thresholds.
 *
 * Rules are deterministic: given the same telemetry window and thresholds they
 * always produce the same violations. Persistence-across-samples is required to
 * reduce single-sample noise.
 */
import type { AnomalyType, Severity, Telemetry, ThresholdViolation } from '../types.js';

export interface Thresholds {
  high_temperature_c: number; // > triggers HIGH_TEMPERATURE
  low_battery_percent: number; // < triggers LOW_BATTERY
  comm_loss_dbm: number; // < triggers COMMUNICATION_LOSS
  abnormal_power_w: number; // > triggers ABNORMAL_POWER_CONSUMPTION
  orbit_deviation_km: number; // > triggers ORBIT_DEVIATION
  min_persisted_samples: number; // how many recent samples must violate
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  high_temperature_c: 75,
  low_battery_percent: 25,
  comm_loss_dbm: -110,
  abnormal_power_w: 850,
  orbit_deviation_km: 25,
  min_persisted_samples: 3,
};

/** Map a normalized "how bad" ratio (0..1+) to a severity band. */
export function severityFromRatio(ratio: number): Severity {
  if (ratio >= 0.85) return 'CRITICAL';
  if (ratio >= 0.55) return 'HIGH';
  if (ratio >= 0.3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Evaluate threshold violations across a recent telemetry window (oldest→newest).
 * baselineAltitude is the satellite's nominal altitude for deviation checks.
 */
export function evaluateViolations(
  samples: Telemetry[],
  thresholds: Thresholds,
  baselineAltitude: number,
): ThresholdViolation[] {
  if (samples.length === 0) return [];
  const latest = samples[samples.length - 1];
  const need = Math.min(thresholds.min_persisted_samples, samples.length);
  const recent = samples.slice(-need);

  const violations: ThresholdViolation[] = [];

  const countViolating = (pred: (t: Telemetry) => boolean) =>
    recent.filter(pred).length;

  // HIGH_TEMPERATURE
  const hotSamples = countViolating((t) => t.temperature_c > thresholds.high_temperature_c);
  if (latest.temperature_c > thresholds.high_temperature_c && hotSamples >= need) {
    violations.push({
      metric: 'temperature_c',
      anomaly_type: 'HIGH_TEMPERATURE',
      value: round(latest.temperature_c),
      threshold: thresholds.high_temperature_c,
      samples_violating: hotSamples,
    });
  }

  // LOW_BATTERY
  const lowBatt = countViolating((t) => t.battery_percent < thresholds.low_battery_percent);
  if (latest.battery_percent < thresholds.low_battery_percent && lowBatt >= need) {
    violations.push({
      metric: 'battery_percent',
      anomaly_type: 'LOW_BATTERY',
      value: round(latest.battery_percent),
      threshold: thresholds.low_battery_percent,
      samples_violating: lowBatt,
    });
  }

  // COMMUNICATION_LOSS
  const commLoss = countViolating((t) => t.signal_strength_dbm < thresholds.comm_loss_dbm);
  if (latest.signal_strength_dbm < thresholds.comm_loss_dbm && commLoss >= need) {
    violations.push({
      metric: 'signal_strength_dbm',
      anomaly_type: 'COMMUNICATION_LOSS',
      value: round(latest.signal_strength_dbm),
      threshold: thresholds.comm_loss_dbm,
      samples_violating: commLoss,
    });
  }

  // ABNORMAL_POWER_CONSUMPTION
  const highPower = countViolating((t) => t.power_consumption_w > thresholds.abnormal_power_w);
  if (latest.power_consumption_w > thresholds.abnormal_power_w && highPower >= need) {
    violations.push({
      metric: 'power_consumption_w',
      anomaly_type: 'ABNORMAL_POWER_CONSUMPTION',
      value: round(latest.power_consumption_w),
      threshold: thresholds.abnormal_power_w,
      samples_violating: highPower,
    });
  }

  // ORBIT_DEVIATION (altitude departs from baseline beyond tolerance)
  const dev = Math.abs(latest.altitude_km - baselineAltitude);
  const devSamples = countViolating(
    (t) => Math.abs(t.altitude_km - baselineAltitude) > thresholds.orbit_deviation_km,
  );
  if (dev > thresholds.orbit_deviation_km && devSamples >= need) {
    violations.push({
      metric: 'altitude_km',
      anomaly_type: 'ORBIT_DEVIATION',
      value: round(dev),
      threshold: thresholds.orbit_deviation_km,
      samples_violating: devSamples,
    });
  }

  return violations;
}

/** Per-anomaly severity based on how far past the threshold we are. */
export function anomalySeverity(
  type: AnomalyType,
  value: number,
  threshold: number,
): Severity {
  let ratio: number;
  switch (type) {
    case 'LOW_BATTERY':
      // Lower battery = worse. At 0% ratio=1, at threshold ratio=0.3.
      ratio = 0.3 + (1 - value / threshold) * 0.7;
      break;
    case 'COMMUNICATION_LOSS':
      // More negative dBm = worse.
      ratio = 0.3 + Math.min(1, Math.abs(value - threshold) / 20) * 0.7;
      break;
    case 'HIGH_TEMPERATURE':
      ratio = 0.3 + Math.min(1, (value - threshold) / 30) * 0.7;
      break;
    case 'ABNORMAL_POWER_CONSUMPTION':
      ratio = 0.3 + Math.min(1, (value - threshold) / 300) * 0.7;
      break;
    case 'ORBIT_DEVIATION':
      ratio = 0.3 + Math.min(1, value / (threshold * 3)) * 0.7;
      break;
    default:
      ratio = 0.3;
  }
  return severityFromRatio(ratio);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
