/**
 * Agent 2 — Anomaly Detection Agent.
 * Consumes a TelemetryObservation, correlates threshold violations, classifies
 * anomalies, computes per-anomaly and overall severity.
 */
import { BaseAgent } from './base.js';
import { anomalySeverity } from '../analysis/anomalyRules.js';
import { maxSeverity } from '../analysis/rootCauseEngine.js';
import type {
  AnomalyDetectionResult,
  DetectedAnomaly,
  Severity,
  TelemetryObservation,
} from '../types.js';

export class AnomalyDetectionAgent extends BaseAgent<TelemetryObservation, AnomalyDetectionResult> {
  readonly agent_id = 'anomaly-detection';
  readonly name = 'Anomaly Detection Agent';
  readonly description = 'Classifies threshold violations into anomalies and assigns severity.';

  protected summarizeInput(o: TelemetryObservation): string {
    return `${o.satellite_id}: ${o.threshold_violations.length} violation(s)`;
  }
  protected summarizeOutput(r: AnomalyDetectionResult): string {
    return `${r.detected_anomalies.length} anomaly(ies), severity=${r.severity}`;
  }

  async execute(observation: TelemetryObservation): Promise<AnomalyDetectionResult> {
    const anomalies: DetectedAnomaly[] = observation.threshold_violations.map((v) => {
      const severity = anomalySeverity(v.anomaly_type, v.value, v.threshold);
      return {
        type: v.anomaly_type,
        severity,
        value: v.value,
        threshold: v.threshold,
        persisted_samples: v.samples_violating,
        description: describe(v.anomaly_type, v.value, v.threshold, v.samples_violating),
      };
    });

    let overall: Severity = 'LOW';
    for (const a of anomalies) overall = maxSeverity(overall, a.severity);

    const evidence = anomalies.map((a) => a.description);

    return {
      detected_anomalies: anomalies,
      severity: overall,
      evidence,
      summary:
        anomalies.length === 0
          ? `No anomalies detected for ${observation.satellite_id}.`
          : `Detected ${anomalies.length} anomaly(ies) for ${observation.satellite_id}: ` +
            anomalies.map((a) => a.type).join(', ') + `. Overall severity ${overall}.`,
    };
  }
}

function describe(type: string, value: number, threshold: number, samples: number): string {
  const labels: Record<string, string> = {
    LOW_BATTERY: `Battery at ${value}% is below the ${threshold}% threshold across ${samples} samples`,
    HIGH_TEMPERATURE: `Temperature at ${value}°C exceeds the ${threshold}°C threshold across ${samples} samples`,
    COMMUNICATION_LOSS: `Signal at ${value}dBm is below the ${threshold}dBm threshold across ${samples} samples`,
    ABNORMAL_POWER_CONSUMPTION: `Power draw at ${value}W exceeds the ${threshold}W threshold across ${samples} samples`,
    ORBIT_DEVIATION: `Altitude deviation of ${value}km exceeds the ${threshold}km tolerance across ${samples} samples`,
  };
  return labels[type] ?? `${type}: value ${value}, threshold ${threshold}`;
}
