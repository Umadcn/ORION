import { describe, it, expect } from 'vitest';
import { buildReportView, fmtMetric, fmtDuration, pctText, NA } from './reportModel';
import type { ReportContent } from '../types';

const legacy: ReportContent = {
  title: 'Investigation Report — ORION-1 Anomaly',
  generated_at: '2026-07-06T15:19:27.000Z',
  safety_statement: 'Advisory only.',
  incident_summary: 'Summary.',
  satellite: { id: 'ORION-1', name: 'Orion One', mission: 'LEO Recon', orbit_type: 'LEO', norad_id: '12345' },
  timeline: [
    { time: '2026-07-06T15:19:20.000Z', event: 'Investigation opened' },
    { time: '2026-07-06T15:19:22.000Z', event: 'Alert raised' },
  ],
  detected_anomalies: ['ABNORMAL_POWER_CONSUMPTION'],
  telemetry_evidence: [{ summary: 'Power high', source_name: 'Telemetry' }],
  space_weather_evidence: null,
  orbit_evidence: null,
  agent_execution_history: [{ agent_name: 'Root Cause Analysis Agent', status: 'COMPLETED', duration_ms: 12, output_summary: 'done' }],
  root_cause: 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION',
  confidence: 0.9,
  severity: 'CRITICAL',
  explanation: 'Power draw exceeded nominal. Battery discharge accelerated.',
  scoring_breakdown: [
    { root_cause: 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION', raw_score: 9, normalized: 0.6, contributions: [{ factor: 'ABNORMAL_POWER', weight: 0.5 }] },
    { root_cause: 'BATTERY_DEGRADATION', raw_score: 4, normalized: 0.25, contributions: [] },
  ],
  recommendations: [{ action: 'Reduce payload duty cycle', rationale: 'Lower draw', priority: 'CRITICAL' }],
  mission_director_decision: 'PENDING',
  reviewed_at: null,
  resolution: 'Current status: WAITING_FOR_REVIEW.',
  resolved_at: null,
  references: [],
  provenance: [],
};

describe('formatting helpers', () => {
  it('formats metrics and marks missing values Not Available', () => {
    expect(fmtMetric(88, '%')).toBe('88%');
    expect(fmtMetric(400, 'W')).toBe('400 W');
    expect(fmtMetric(null, 'W')).toBe(NA);
  });
  it('formats durations and percentages', () => {
    expect(fmtDuration(12)).toBe('12 ms');
    expect(fmtDuration(1500)).toBe('1.50 s');
    expect(pctText(0.97)).toBe('97%');
    expect(pctText(null)).toBe(NA);
  });
});

describe('buildReportView — legacy report derivation (no fabrication)', () => {
  const v = buildReportView(legacy);

  it('derives RCA from scoring_breakdown when structured rca is absent', () => {
    expect(v.rca.primary_root_cause).toBe('PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION');
    expect(v.rca.reasoning.length).toBeGreaterThan(0);
    expect(v.rca.contributing_factors[0].factor).toBe('Abnormal Power');
    expect(v.rca.alternative_hypotheses[0].hypothesis).toBe('Battery Degradation');
  });

  it('leaves telemetry snapshot empty for legacy content (shows Not Available in UI)', () => {
    expect(v.telemetry).toEqual([]);
    expect(v.telemetryTime).toBeNull();
  });

  it('derives anomalies from detected_anomalies with Not Available observed values', () => {
    expect(v.anomalies).toHaveLength(1);
    expect(v.anomalies[0].anomaly_type).toBe('Abnormal Power Consumption');
    expect(v.anomalies[0].observed_value).toBe(NA);
  });

  it('produces a completeness score out of 100', () => {
    expect(v.completeness.max).toBe(100);
    expect(v.completeness.categories.reduce((s, c) => s + c.max, 0)).toBe(100);
    expect(v.completeness.score).toBeGreaterThan(0);
    expect(v.completeness.score).toBeLessThanOrEqual(100);
  });

  it('marks review pending and risk empty when not decided/derivable', () => {
    expect(v.review.status).toContain('PENDING');
    expect(v.risk).toEqual([]); // legacy content has no structured risk → Not Available
  });
});

describe('buildReportView — prefers structured v2 fields when present', () => {
  it('uses the structured sections verbatim', () => {
    const v2: ReportContent = {
      ...legacy,
      telemetry_snapshot: [{ key: 'battery_percent', label: 'Battery', value: 88, unit: '%', expected: '≥ 25%', status: 'NORMAL' }],
      telemetry_snapshot_time: '2026-07-06T15:19:20.000Z',
      completeness: { score: 94, max: 100, categories: [{ key: 'x', label: 'X', score: 94, max: 100 }] },
      risk_assessment: [{ category: 'Power', likelihood: 'High', impact: 'Severe', level: 'HIGH', mitigation: 'Reduce load' }],
    };
    const v = buildReportView(v2);
    expect(v.telemetry).toHaveLength(1);
    expect(v.telemetry[0].value).toBe(88);
    expect(v.completeness.score).toBe(94);
    expect(v.risk[0].level).toBe('HIGH');
  });
});
