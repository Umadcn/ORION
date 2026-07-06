import { describe, it, expect } from 'vitest';
import {
  buildAnomalies,
  buildAuditTrail,
  buildRca,
  buildRisk,
  buildTelemetrySnapshot,
  computeCompleteness,
} from '../src/services/reportComposer.js';
import { DEFAULT_THRESHOLDS } from '../src/analysis/anomalyRules.js';
import type { Alert, Evidence, Investigation, Recommendation, Satellite, Telemetry } from '../src/types.js';

const TH = DEFAULT_THRESHOLDS;

const sat: Satellite = {
  id: 'ORION-X', name: 'Orion X', norad_id: '99999', mission: 'Test', orbit_type: 'LEO',
  altitude: 550, velocity: 7.6, latitude: 0, longitude: 0, health_score: 94.18, status: 'HEALTHY',
};

const healthyTelemetry: Telemetry = {
  id: 1, satellite_id: 'ORION-X', timestamp: '2026-07-06T15:19:20.000Z',
  temperature_c: 30, battery_percent: 88, signal_strength_dbm: -80, power_consumption_w: 400,
  altitude_km: 550, velocity_kms: 7.6, latitude: 10, longitude: 20,
};

const criticalTelemetry: Telemetry = {
  ...healthyTelemetry, temperature_c: 92, battery_percent: 12, power_consumption_w: 980, signal_strength_dbm: -120,
};

const inv: Investigation = {
  id: 27, title: 'ORION-X Anomaly Investigation', satellite_id: 'ORION-X', status: 'WAITING_FOR_REVIEW',
  priority: 'CRITICAL', detected_anomalies: '["ABNORMAL_POWER_CONSUMPTION"]',
  root_cause: 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION', confidence: 0.97, severity: 'CRITICAL',
  explanation: 'Power draw exceeded nominal. Battery discharge accelerated. Payload subsystem implicated.',
  scoring_breakdown: JSON.stringify([
    { root_cause: 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION', raw_score: 9, normalized: 0.6, contributions: [{ factor: 'ABNORMAL_POWER', weight: 0.5 }, { factor: 'LOW_BATTERY', weight: 0.3 }] },
    { root_cause: 'BATTERY_DEGRADATION', raw_score: 4, normalized: 0.25, contributions: [{ factor: 'LOW_BATTERY', weight: 0.25 }] },
  ]),
  review_decision: null, created_at: '2026-07-06T15:19:24.000Z', updated_at: '2026-07-06T15:19:27.000Z',
  reviewed_at: null, resolved_at: null,
};

describe('buildTelemetrySnapshot', () => {
  it('flags violations as CRITICAL and healthy values as NORMAL', () => {
    const snap = buildTelemetrySnapshot(criticalTelemetry, TH, 40);
    const battery = snap.find((m) => m.key === 'battery_percent')!;
    const temp = snap.find((m) => m.key === 'temperature_c')!;
    expect(battery.status).toBe('CRITICAL');
    expect(temp.status).toBe('CRITICAL');
    expect(battery.value).toBe(12);
    const healthySnap = buildTelemetrySnapshot(healthyTelemetry, TH, 94.18);
    expect(healthySnap.find((m) => m.key === 'temperature_c')!.status).toBe('NORMAL');
  });
  it('returns UNKNOWN status and null values when there is no telemetry', () => {
    const snap = buildTelemetrySnapshot(null, TH, null);
    expect(snap.every((m) => m.value === null)).toBe(true);
    expect(snap.every((m) => m.status === 'UNKNOWN')).toBe(true);
  });
});

describe('buildAnomalies', () => {
  it('builds structured rows from alerts with observed values and thresholds', () => {
    const alerts: Alert[] = [
      { id: 1, satellite_id: 'ORION-X', anomaly_type: 'ABNORMAL_POWER_CONSUMPTION', severity: 'CRITICAL', message: 'Power spike', status: 'ACTIVE', investigation_id: 27, created_at: '2026-07-06T15:19:22.000Z' },
    ];
    const rows = buildAnomalies(alerts, ['ABNORMAL_POWER_CONSUMPTION'], criticalTelemetry, TH);
    expect(rows).toHaveLength(1);
    expect(rows[0].metric).toContain('Power');
    expect(rows[0].observed_value).toBe('980');
    expect(rows[0].expected).toContain(String(TH.abnormal_power_w));
    expect(rows[0].severity).toBe('CRITICAL');
  });
  it('falls back to the detected-anomaly list when no alerts exist', () => {
    const rows = buildAnomalies([], ['LOW_BATTERY'], null, TH);
    expect(rows[0].observed_value).toBe('Not Available');
    expect(rows[0].anomaly_type).toBe('Low Battery');
  });
});

describe('buildRca', () => {
  it('produces reasoning bullets, contributing factors, distribution, and ranked alternatives', () => {
    const evidence: Evidence[] = [
      { id: 5, investigation_id: 27, source_type: 'SYSTEM', source_name: 'Root Cause Analysis Agent', summary: 'Power draw exceeded the abnormal-power threshold across the window.', details: '{}', reliability_score: 0.8, supports_root_cause: 1, timestamp: '2026-07-06T15:19:26.000Z', source_url: null, mode: null, cached: 0, fallback_used: 0 },
    ];
    const rca = buildRca(inv, evidence);
    expect(rca.primary_root_cause).toBe('PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION');
    expect(rca.status).toBe('COMPLETED');
    expect(rca.reasoning.length).toBeGreaterThan(0);
    expect(rca.contributing_factors[0].factor).toBe('Abnormal Power');
    expect(rca.evidence_distribution.length).toBe(2);
    expect(rca.alternative_hypotheses[0].hypothesis).toBe('Battery Degradation');
    expect(rca.supporting_evidence[0].id).toBe('EV-5');
  });
});

describe('buildRisk', () => {
  it('derives risk from severity + confidence only when both exist', () => {
    const recs: Recommendation[] = [{ id: 1, investigation_id: 27, action: 'Reduce payload duty cycle', rationale: 'Lower draw', priority: 'CRITICAL' }];
    const risk = buildRisk(inv, recs);
    expect(risk).toHaveLength(1);
    expect(risk[0].impact).toBe('Severe');
    expect(risk[0].likelihood).toBe('High');
    expect(risk[0].mitigation).toBe('Reduce payload duty cycle');
  });
  it('returns [] (Not Available) when severity/confidence/root cause missing', () => {
    const bare: Investigation = { ...inv, severity: null, confidence: null, root_cause: null };
    expect(buildRisk(bare, [])).toEqual([]);
  });
});

describe('buildAuditTrail', () => {
  it('derives audit rows from alerts + executions + lifecycle, sorted by time', () => {
    const alerts: Alert[] = [
      { id: 1, satellite_id: 'ORION-X', anomaly_type: 'ABNORMAL_POWER_CONSUMPTION', severity: 'CRITICAL', message: 'x', status: 'ACTIVE', investigation_id: 27, created_at: '2026-07-06T15:19:22.000Z' },
    ];
    const rows = buildAuditTrail({ ...inv, reviewed_at: '2026-07-06T15:30:00.000Z', review_decision: 'APPROVED' }, alerts, []);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].timestamp <= rows[rows.length - 1].timestamp).toBe(true);
    expect(rows.some((r) => r.actor === 'Mission Director')).toBe(true);
  });
});

describe('computeCompleteness', () => {
  it('scores out of 100 and returns per-category maxima summing to 100', () => {
    const result = computeCompleteness({
      hasTelemetry: true, satellite: sat, healthPresent: true, evidenceCount: 6, confidence: 0.97,
      agentCount: 6, timelineCount: 4, decisionTraceCount: 8, auditCount: 6, recommendationCount: 3,
      hasRootCause: true, hasSeverity: true, hasSafetyStatement: true,
    });
    expect(result.max).toBe(100);
    expect(result.categories.reduce((s, c) => s + c.max, 0)).toBe(100);
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.score).toBeLessThanOrEqual(100);
  });
  it('produces a low score for a sparse investigation', () => {
    const result = computeCompleteness({
      hasTelemetry: false, satellite: { ...sat, mission: '', norad_id: '' }, healthPresent: false,
      evidenceCount: 0, confidence: null, agentCount: 0, timelineCount: 0, decisionTraceCount: 0,
      auditCount: 0, recommendationCount: 0, hasRootCause: false, hasSeverity: false, hasSafetyStatement: true,
    });
    expect(result.score).toBeLessThan(20);
  });
});
