/**
 * Agent 1 — Telemetry Monitoring Agent.
 * Inspects a recent telemetry window, computes trends and a health score, and
 * flags threshold violations, producing a structured TelemetryObservation.
 */
import { BaseAgent } from './base.js';
import { evaluateViolations, type Thresholds } from '../analysis/anomalyRules.js';
import type { Telemetry, TelemetryObservation, Trend } from '../types.js';

export interface TelemetryMonitoringInput {
  satelliteId: string;
  samples: Telemetry[]; // oldest → newest
  thresholds: Thresholds;
  baselineAltitude: number;
}

export class TelemetryMonitoringAgent extends BaseAgent<TelemetryMonitoringInput, TelemetryObservation> {
  readonly agent_id = 'telemetry-monitoring';
  readonly name = 'Telemetry Monitoring Agent';
  readonly description = 'Inspects recent telemetry, computes trends and health, flags threshold violations.';

  protected summarizeInput(input: TelemetryMonitoringInput): string {
    return `${input.satelliteId}: ${input.samples.length} samples analyzed`;
  }
  protected summarizeOutput(o: TelemetryObservation): string {
    return `health=${o.health_score}, violations=${o.threshold_violations.length}`;
  }

  async execute(input: TelemetryMonitoringInput): Promise<TelemetryObservation> {
    const { samples, thresholds, baselineAltitude, satelliteId } = input;
    if (samples.length === 0) {
      throw new Error(`No telemetry available for ${satelliteId}`);
    }
    const latest = samples[samples.length - 1];
    const violations = evaluateViolations(samples, thresholds, baselineAltitude);

    const health = computeHealth(latest, thresholds);

    return {
      satellite_id: satelliteId,
      sample_count: samples.length,
      latest_values: {
        temperature_c: latest.temperature_c,
        battery_percent: latest.battery_percent,
        signal_strength_dbm: latest.signal_strength_dbm,
        power_consumption_w: latest.power_consumption_w,
        altitude_km: latest.altitude_km,
      },
      battery_trend: trend(samples.map((s) => s.battery_percent)),
      temperature_trend: trend(samples.map((s) => s.temperature_c)),
      power_trend: trend(samples.map((s) => s.power_consumption_w)),
      signal_trend: trend(samples.map((s) => s.signal_strength_dbm)),
      altitude_deviation: round(Math.abs(latest.altitude_km - baselineAltitude)),
      health_score: health,
      threshold_violations: violations,
      observation_summary: buildSummary(satelliteId, latest, violations.length, health),
    };
  }
}

function trend(values: number[]): Trend {
  if (values.length < 2) return { direction: 'STABLE', delta: 0, ratePerMin: 0 };
  const window = values.slice(-Math.min(10, values.length));
  const delta = window[window.length - 1] - window[0];
  // Assume ~2s spacing during live sim; report per-minute rate.
  const minutes = (window.length - 1) * (2 / 60);
  const ratePerMin = minutes > 0 ? delta / minutes : 0;
  const direction = Math.abs(delta) < 0.5 ? 'STABLE' : delta > 0 ? 'RISING' : 'FALLING';
  return { direction, delta: round(delta), ratePerMin: round(ratePerMin) };
}

function computeHealth(t: Telemetry, th: Thresholds): number {
  // Weighted penalty model: 100 = perfect. Each impaired metric subtracts.
  let score = 100;
  if (t.battery_percent < th.low_battery_percent) score -= (th.low_battery_percent - t.battery_percent) * 1.5;
  else score -= Math.max(0, (60 - t.battery_percent)) * 0.2;
  if (t.temperature_c > th.high_temperature_c) score -= (t.temperature_c - th.high_temperature_c) * 1.2;
  if (t.signal_strength_dbm < th.comm_loss_dbm) score -= Math.abs(t.signal_strength_dbm - th.comm_loss_dbm) * 1.0;
  if (t.power_consumption_w > th.abnormal_power_w) score -= (t.power_consumption_w - th.abnormal_power_w) * 0.05;
  return round(Math.max(0, Math.min(100, score)));
}

function buildSummary(id: string, t: Telemetry, violations: number, health: number): string {
  return (
    `${id} latest telemetry — battery ${t.battery_percent}%, temp ${t.temperature_c}°C, ` +
    `power ${t.power_consumption_w}W, signal ${t.signal_strength_dbm}dBm. ` +
    `Health score ${health}/100 with ${violations} threshold violation(s).`
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
