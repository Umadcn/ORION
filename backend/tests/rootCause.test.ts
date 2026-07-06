import { describe, it, expect } from 'vitest';
import { computeScores, computeConfidence } from '../src/analysis/scoring.js';
import { analyzeRootCause } from '../src/analysis/rootCauseEngine.js';
import type {
  AnomalyDetectionResult,
  InvestigationEvidenceBundle,
  OrbitEvidence,
  SpaceWeatherEvidence,
  TelemetryObservation,
} from '../src/types.js';

function quietSpaceWeather(): SpaceWeatherEvidence {
  return {
    solar_activity: 'low', geomagnetic_condition: 'QUIET', kp_index: 2.3,
    relevant_to_incident: false, explanation: 'Quiet conditions.',
    source_name: 'NOAA SWPC', source_url: 'x', retrieved_at: 'x',
    mode: 'OFFLINE_FIXTURE', cached: false, fallback_used: false,
  };
}
function nominalOrbit(): OrbitEvidence {
  return {
    orbit_type: 'LEO', altitude_context: 'x', tle_summary: 'x',
    orbit_deviation_detected: false, relevant_to_incident: false, explanation: 'Nominal.',
    source_name: 'CelesTrak', source_url: 'x', retrieved_at: 'x',
    mode: 'OFFLINE_FIXTURE', cached: false, fallback_used: false,
  };
}
function observation(): TelemetryObservation {
  return {
    satellite_id: 'ORION-3', sample_count: 10,
    latest_values: { temperature_c: 30, battery_percent: 18, signal_strength_dbm: -96, power_consumption_w: 1000, altitude_km: 545 },
    battery_trend: { direction: 'FALLING', delta: -50, ratePerMin: -30 },
    temperature_trend: { direction: 'RISING', delta: 6, ratePerMin: 3 },
    power_trend: { direction: 'RISING', delta: 300, ratePerMin: 150 },
    signal_trend: { direction: 'STABLE', delta: 0, ratePerMin: 0 },
    altitude_deviation: 0, health_score: 20, threshold_violations: [],
    observation_summary: 'ORION-3 battery falling, power rising.',
  };
}
function powerAnomalies(): AnomalyDetectionResult {
  return {
    detected_anomalies: [
      { type: 'LOW_BATTERY', severity: 'HIGH', value: 18, threshold: 25, persisted_samples: 4, description: 'low batt' },
      { type: 'ABNORMAL_POWER_CONSUMPTION', severity: 'HIGH', value: 1000, threshold: 850, persisted_samples: 4, description: 'high power' },
    ],
    severity: 'HIGH', evidence: [], summary: 'power incident',
  };
}

const powerBundle: InvestigationEvidenceBundle = {
  observation: observation(),
  anomalies: powerAnomalies(),
  spaceWeather: quietSpaceWeather(),
  orbit: nominalOrbit(),
};

describe('deterministic root cause engine', () => {
  it('identifies PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION for low-battery + high-power under quiet space weather', () => {
    const result = analyzeRootCause(powerBundle);
    expect(result.root_cause).toBe('PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION');
  });

  it('produces confidence in the expected 80-95% band for this scenario', () => {
    const result = analyzeRootCause(powerBundle);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.confidence).toBeLessThanOrEqual(0.97);
  });

  it('is deterministic — identical inputs give identical outputs', () => {
    const a = analyzeRootCause(powerBundle);
    const b = analyzeRootCause(powerBundle);
    expect(a).toEqual(b);
  });

  it('rates severity HIGH or CRITICAL', () => {
    const result = analyzeRootCause(powerBundle);
    expect(['HIGH', 'CRITICAL']).toContain(result.severity);
  });

  it('lists quiet space weather as contradicting evidence', () => {
    const result = analyzeRootCause(powerBundle);
    expect(result.contradicting_evidence.join(' ')).toMatch(/space-weather|orbit/i);
  });

  it('returns UNKNOWN_ANOMALY with no anomalies', () => {
    const result = analyzeRootCause({ ...powerBundle, anomalies: { detected_anomalies: [], severity: 'LOW', evidence: [], summary: 'none' } });
    expect(result.root_cause).toBe('UNKNOWN_ANOMALY');
  });

  it('scores communication failure highest for COMMUNICATION_LOSS', () => {
    const scores = computeScores({
      anomalies: { detected_anomalies: [{ type: 'COMMUNICATION_LOSS', severity: 'HIGH', value: -120, threshold: -110, persisted_samples: 3, description: 'x' }], severity: 'HIGH', evidence: [], summary: '' },
      spaceWeather: quietSpaceWeather(),
      orbit: nominalOrbit(),
    });
    expect(scores[0].root_cause).toBe('COMMUNICATION_SUBSYSTEM_FAILURE');
  });

  it('confidence stays within [0.5, 0.97]', () => {
    const scores = computeScores({ anomalies: powerAnomalies(), spaceWeather: quietSpaceWeather(), orbit: nominalOrbit() });
    const c = computeConfidence(scores);
    expect(c).toBeGreaterThanOrEqual(0.5);
    expect(c).toBeLessThanOrEqual(0.97);
  });
});
