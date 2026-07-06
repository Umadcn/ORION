/**
 * Report Composer — deterministic assembly of the professional, structured
 * sections of an Investigation Report from EXISTING investigation data.
 *
 * This module NEVER invents data. Every value is derived from the persisted
 * investigation, its telemetry, alerts, evidence, recommendations, agent
 * executions, and non-secret system configuration. When a data point is
 * unavailable the corresponding field is null / empty and the UI renders
 * "Not Available" rather than a fabricated value.
 *
 * The report completeness score (out of 100) is computed here from the actual
 * presence and richness of investigation data; the scoring formula is
 * documented in `computeCompleteness()`.
 */
import { describeLlmConfig } from '../config.js';
import type { Thresholds } from '../analysis/anomalyRules.js';
import type {
  AgentExecution,
  Alert,
  Evidence,
  Investigation,
  Recommendation,
  Satellite,
  ScoringEntry,
  Telemetry,
} from '../types.js';

/** Deterministic engine/build version tags surfaced for transparency & audit. */
export const RCA_ENGINE_VERSION = '2.0.0';
export const RULESET_VERSION = '1.3.0';
export const REPORT_GENERATOR_VERSION = '2.0.0';

// ---------- Structured section shapes (all additive to the report) ----------

export type MetricStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

export interface ReportTelemetryMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  expected: string | null;
  status: MetricStatus;
}

export interface ReportAnomalyRow {
  index: number;
  anomaly_type: string;
  metric: string;
  observed_value: string;
  expected: string;
  severity: string;
  detection_time: string | null;
  status: string;
  evidence: string | null;
}

export interface ReportEvidenceRow {
  id: string;
  type: string;
  source: string;
  observation: string;
  weight: number;
  supports: boolean;
  timestamp: string;
}

export interface ReportContributingFactor {
  factor: string;
  weight: number;
}

export interface ReportEvidenceDistribution {
  root_cause: string;
  normalized: number;
}

export interface ReportAlternativeHypothesis {
  hypothesis: string;
  confidence: number;
  note: string;
}

export interface ReportRca {
  primary_root_cause: string | null;
  confidence: number | null;
  severity: string | null;
  status: string;
  reasoning: string[];
  contributing_factors: ReportContributingFactor[];
  evidence_distribution: ReportEvidenceDistribution[];
  supporting_evidence: ReportEvidenceRow[];
  alternative_hypotheses: ReportAlternativeHypothesis[];
}

export interface ReportAgentDetail {
  agent_id: string;
  agent_name: string;
  purpose: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  output_summary: string;
  confidence: number | null;
}

export interface ReportAuditRow {
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  result: string;
}

export interface ReportRiskRow {
  category: string;
  likelihood: string;
  impact: string;
  level: string;
  mitigation: string;
}

export interface ReportSystemTransparency {
  analysis_mode: string;
  rca_engine_version: string;
  ruleset_version: string;
  report_generator_version: string;
  llm_provider: string;
  llm_model: string | null;
  fallback_mode_used: boolean;
  grounding_status: string;
  human_review_required: boolean;
}

export interface ReportCompletenessCategory {
  key: string;
  label: string;
  score: number;
  max: number;
}

export interface ReportCompleteness {
  score: number;
  max: number;
  categories: ReportCompletenessCategory[];
}

export interface ReportReview {
  status: string;
  reviewed_by: string;
  review_date: string | null;
  decision: string;
  notes: string;
}

export interface ReportExecutiveSummary {
  primary_finding: string;
  detected_condition: string;
  operational_impact: string;
  current_status: string;
  required_human_action: string;
}

export interface ComposerInput {
  investigation: Investigation;
  satellite: Satellite;
  alerts: Alert[];
  evidence: Evidence[];
  recommendations: Recommendation[];
  agentExecutions: AgentExecution[];
  latestTelemetry: Telemetry | null;
  thresholds: Thresholds;
  reportFallbackUsed: boolean;
}

// ---------- Small deterministic helpers ----------

function humanize(token: string | null | undefined): string {
  if (!token) return 'Unknown';
  return token
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Split a paragraph explanation into concise sentence bullets (3–6). */
function toBullets(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 6);
}

// ---------- Telemetry snapshot ----------

/**
 * Build the telemetry snapshot from the latest real sample + active thresholds.
 * Hard-threshold metrics are CRITICAL when violated, WARNING within a 10% margin
 * of the threshold, else NORMAL. Health uses the 80 / 55 bands. When there is no
 * telemetry sample every value is null and status UNKNOWN (renders "Not Available").
 */
export function buildTelemetrySnapshot(t: Telemetry | null, th: Thresholds, healthScore: number | null): ReportTelemetryMetric[] {
  const near = (v: number, limit: number) => Math.abs(v - limit) <= Math.abs(limit) * 0.1;

  const battery = (): MetricStatus => {
    if (!t) return 'UNKNOWN';
    if (t.battery_percent < th.low_battery_percent) return 'CRITICAL';
    if (near(t.battery_percent, th.low_battery_percent)) return 'WARNING';
    return 'NORMAL';
  };
  const temp = (): MetricStatus => {
    if (!t) return 'UNKNOWN';
    if (t.temperature_c > th.high_temperature_c) return 'CRITICAL';
    if (near(t.temperature_c, th.high_temperature_c)) return 'WARNING';
    return 'NORMAL';
  };
  const power = (): MetricStatus => {
    if (!t) return 'UNKNOWN';
    if (t.power_consumption_w > th.abnormal_power_w) return 'CRITICAL';
    if (near(t.power_consumption_w, th.abnormal_power_w)) return 'WARNING';
    return 'NORMAL';
  };
  const signal = (): MetricStatus => {
    if (!t) return 'UNKNOWN';
    if (t.signal_strength_dbm < th.comm_loss_dbm) return 'CRITICAL';
    if (near(t.signal_strength_dbm, th.comm_loss_dbm)) return 'WARNING';
    return 'NORMAL';
  };
  const health = (): MetricStatus => {
    if (healthScore == null) return 'UNKNOWN';
    if (healthScore >= 80) return 'NORMAL';
    if (healthScore >= 55) return 'WARNING';
    return 'CRITICAL';
  };

  return [
    { key: 'battery_percent', label: 'Battery', value: t?.battery_percent ?? null, unit: '%', expected: `≥ ${th.low_battery_percent}%`, status: battery() },
    { key: 'temperature_c', label: 'Temperature', value: t?.temperature_c ?? null, unit: '°C', expected: `≤ ${th.high_temperature_c} °C`, status: temp() },
    { key: 'power_consumption_w', label: 'Power Consumption', value: t?.power_consumption_w ?? null, unit: 'W', expected: `≤ ${th.abnormal_power_w} W`, status: power() },
    { key: 'signal_strength_dbm', label: 'Signal Strength', value: t?.signal_strength_dbm ?? null, unit: 'dBm', expected: `≥ ${th.comm_loss_dbm} dBm`, status: signal() },
    { key: 'altitude_km', label: 'Altitude', value: t?.altitude_km ?? null, unit: 'km', expected: null, status: t ? 'NORMAL' : 'UNKNOWN' },
    { key: 'velocity_kms', label: 'Velocity', value: t?.velocity_kms ?? null, unit: 'km/s', expected: null, status: t ? 'NORMAL' : 'UNKNOWN' },
    { key: 'latitude', label: 'Latitude', value: t?.latitude ?? null, unit: '°', expected: null, status: t ? 'NORMAL' : 'UNKNOWN' },
    { key: 'longitude', label: 'Longitude', value: t?.longitude ?? null, unit: '°', expected: null, status: t ? 'NORMAL' : 'UNKNOWN' },
    { key: 'health_score', label: 'Health Score', value: healthScore ?? null, unit: '/100', expected: '≥ 80', status: health() },
  ];
}

// ---------- Detected anomalies (structured) ----------

interface AnomalyMetricMap {
  metric: string;
  observed: (t: Telemetry) => number;
  expected: (th: Thresholds) => string;
}

const ANOMALY_MAP: Record<string, AnomalyMetricMap> = {
  HIGH_TEMPERATURE: { metric: 'Temperature (°C)', observed: (t) => t.temperature_c, expected: (th) => `≤ ${th.high_temperature_c} °C` },
  LOW_BATTERY: { metric: 'Battery (%)', observed: (t) => t.battery_percent, expected: (th) => `≥ ${th.low_battery_percent}%` },
  COMMUNICATION_LOSS: { metric: 'Signal (dBm)', observed: (t) => t.signal_strength_dbm, expected: (th) => `≥ ${th.comm_loss_dbm} dBm` },
  ABNORMAL_POWER_CONSUMPTION: { metric: 'Power (W)', observed: (t) => t.power_consumption_w, expected: (th) => `≤ ${th.abnormal_power_w} W` },
  ORBIT_DEVIATION: { metric: 'Altitude (km)', observed: (t) => t.altitude_km, expected: (th) => `± ${th.orbit_deviation_km} km` },
};

export function buildAnomalies(alerts: Alert[], detectedAnomalies: string[], t: Telemetry | null, th: Thresholds): ReportAnomalyRow[] {
  if (alerts.length > 0) {
    return alerts.map((a, i) => {
      const m = ANOMALY_MAP[a.anomaly_type];
      return {
        index: i + 1,
        anomaly_type: humanize(a.anomaly_type),
        metric: m?.metric ?? '—',
        observed_value: m && t ? String(Math.round(m.observed(t) * 100) / 100) : 'Not Available',
        expected: m ? m.expected(th) : 'Not Available',
        severity: a.severity,
        detection_time: a.created_at,
        status: a.status,
        evidence: a.message ?? null,
      };
    });
  }
  // No alert rows persisted → fall back to the detected-anomaly type list.
  return detectedAnomalies.map((type, i) => {
    const m = ANOMALY_MAP[type];
    return {
      index: i + 1,
      anomaly_type: humanize(type),
      metric: m?.metric ?? '—',
      observed_value: m && t ? String(Math.round(m.observed(t) * 100) / 100) : 'Not Available',
      expected: m ? m.expected(th) : 'Not Available',
      severity: '—',
      detection_time: null,
      status: '—',
      evidence: null,
    };
  });
}

// ---------- Root Cause Analysis (structured) ----------

export function buildRca(inv: Investigation, evidence: Evidence[]): ReportRca {
  const scoring = safeJson<ScoringEntry[]>(inv.scoring_breakdown, []);
  const sorted = [...scoring].sort((a, b) => b.normalized - a.normalized);
  const top = sorted.find((s) => s.root_cause === inv.root_cause) ?? sorted[0];

  // Reasoning bullets come from the RCA agent's own supporting-evidence entries
  // (stored as SYSTEM / "Root Cause Analysis Agent" evidence), else the
  // explanation paragraph split into sentences.
  const rcaEvidence = evidence.filter((e) => e.source_type === 'SYSTEM' && e.source_name === 'Root Cause Analysis Agent');
  const reasoning = rcaEvidence.length > 0 ? rcaEvidence.map((e) => e.summary).slice(0, 6) : toBullets(inv.explanation);

  const contributing = (top?.contributions ?? [])
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((c) => ({ factor: humanize(c.factor), weight: c.weight }));

  const distribution = sorted.map((s) => ({ root_cause: humanize(s.root_cause), normalized: s.normalized }));

  const supporting: ReportEvidenceRow[] = evidence.map((e) => ({
    id: `EV-${e.id}`,
    type: humanize(e.source_type),
    source: e.source_name,
    observation: e.summary,
    weight: e.reliability_score,
    supports: !!e.supports_root_cause,
    timestamp: e.timestamp,
  }));

  const alternatives: ReportAlternativeHypothesis[] = sorted
    .filter((s) => s.root_cause !== (inv.root_cause ?? top?.root_cause))
    .slice(0, 3)
    .map((s) => ({
      hypothesis: humanize(s.root_cause),
      confidence: s.normalized,
      note: 'Lower composite evidence score than the primary root cause.',
    }));

  return {
    primary_root_cause: inv.root_cause,
    confidence: inv.confidence,
    severity: inv.severity,
    status: inv.root_cause ? 'COMPLETED' : 'INCONCLUSIVE',
    reasoning,
    contributing_factors: contributing,
    evidence_distribution: distribution,
    supporting_evidence: supporting,
    alternative_hypotheses: alternatives,
  };
}

// ---------- Agent execution detail ----------

const AGENT_PURPOSE: Record<string, string> = {
  'telemetry-monitoring': 'Continuous telemetry ingestion, trend analysis, and health scoring.',
  'anomaly-detection': 'Threshold evaluation and anomaly classification against configured limits.',
  'root-cause-analysis': 'Deterministic multi-hypothesis weighted scoring to determine the root cause.',
  'orbit-intelligence': 'Orbital context and altitude-deviation assessment.',
  'space-weather': 'Correlation of the incident with space-weather conditions.',
  'report-generation': 'Assembly of the structured, auditable investigation report.',
};

export function buildAgents(execs: AgentExecution[], confidence: number | null): ReportAgentDetail[] {
  return execs.map((e) => ({
    agent_id: e.agent_id,
    agent_name: e.agent_name,
    purpose: AGENT_PURPOSE[e.agent_id] ?? 'Investigation support agent.',
    status: e.status,
    started_at: e.started_at,
    completed_at: e.completed_at,
    duration_ms: e.duration_ms,
    output_summary: e.output_summary,
    confidence: e.agent_id === 'root-cause-analysis' ? confidence : null,
  }));
}

// ---------- Decision trace ----------

export function buildDecisionTrace(): string[] {
  return [
    'Telemetry Received',
    'Threshold Evaluation',
    'Anomaly Detection',
    'Evidence Collection',
    'Root Cause Analysis',
    'Confidence Calculation',
    'Human Review Recommendation',
    'Report Generation',
  ];
}

// ---------- Risk assessment (derived from severity + confidence) ----------

/**
 * Risk is derived ONLY from real investigation data: impact from the assessed
 * severity, likelihood from the RCA confidence. Returns [] when either input is
 * missing so the UI can honestly show "Not Available" instead of a fabricated
 * matrix.
 */
export function buildRisk(inv: Investigation, recommendations: Recommendation[]): ReportRiskRow[] {
  if (!inv.severity || inv.confidence == null || !inv.root_cause) return [];
  const impact = inv.severity === 'CRITICAL' ? 'Severe' : inv.severity === 'HIGH' ? 'Major' : inv.severity === 'MEDIUM' ? 'Moderate' : 'Minor';
  const likelihood = inv.confidence >= 0.8 ? 'High' : inv.confidence >= 0.5 ? 'Moderate' : 'Low';
  const level = inv.severity === 'CRITICAL' || inv.severity === 'HIGH' ? 'HIGH' : inv.severity === 'MEDIUM' ? 'MEDIUM' : 'LOW';
  const mitigation = recommendations[0]?.action ?? 'Escalate for authorized human review.';
  return [
    {
      category: humanize(inv.root_cause),
      likelihood,
      impact,
      level,
      mitigation,
    },
  ];
}

// ---------- Audit trail (derived from real execution + lifecycle events) ----------

export function buildAuditTrail(inv: Investigation, alerts: Alert[], execs: AgentExecution[]): ReportAuditRow[] {
  const rows: ReportAuditRow[] = [];
  for (const a of alerts) {
    rows.push({
      timestamp: a.created_at,
      actor: 'Anomaly Detection Agent',
      action: `Alert raised: ${humanize(a.anomaly_type)}`,
      resource: a.satellite_id,
      result: a.severity,
    });
  }
  for (const e of execs) {
    rows.push({
      timestamp: e.started_at,
      actor: e.agent_name,
      action: 'Agent execution',
      resource: `Investigation #${inv.id}`,
      result: e.status,
    });
  }
  if (inv.reviewed_at) {
    rows.push({
      timestamp: inv.reviewed_at,
      actor: 'Mission Director',
      action: `Human review — ${inv.review_decision ?? 'DECISION'}`,
      resource: `Investigation #${inv.id}`,
      result: inv.review_decision ?? '—',
    });
  }
  if (inv.resolved_at) {
    rows.push({
      timestamp: inv.resolved_at,
      actor: 'System',
      action: 'Investigation resolved',
      resource: `Investigation #${inv.id}`,
      result: 'RESOLVED',
    });
  }
  return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ---------- System & model transparency ----------

export function buildTransparency(reportFallbackUsed: boolean, anyAgentFallback: boolean): ReportSystemTransparency {
  const llm = describeLlmConfig(); // non-secret only — never exposes keys/tokens
  const realLlm = llm.real_provider_configured;
  return {
    analysis_mode: realLlm ? 'LLM_ASSISTED' : 'DETERMINISTIC',
    rca_engine_version: RCA_ENGINE_VERSION,
    ruleset_version: RULESET_VERSION,
    report_generator_version: REPORT_GENERATOR_VERSION,
    llm_provider: llm.provider,
    llm_model: llm.model,
    fallback_mode_used: reportFallbackUsed || anyAgentFallback || (!realLlm && llm.fallback_enabled),
    grounding_status: realLlm ? 'PROVIDER_GROUNDED' : 'DETERMINISTIC_RULES',
    human_review_required: true,
  };
}

// ---------- Review section ----------

export function buildReview(inv: Investigation): ReportReview {
  const decided = !!inv.review_decision;
  return {
    status: decided ? `${inv.review_decision} — HUMAN REVIEWED` : 'PENDING HUMAN REVIEW',
    reviewed_by: decided ? 'Mission Director' : 'Not Yet Assigned',
    review_date: inv.reviewed_at,
    decision: inv.review_decision ?? 'PENDING',
    notes: '—',
  };
}

// ---------- Executive summary ----------

export function buildExecutiveSummary(inv: Investigation, sat: Satellite, anomalies: string[], recommendations: Recommendation[]): ReportExecutiveSummary {
  const rc = inv.root_cause ? humanize(inv.root_cause) : 'Inconclusive';
  const condition = anomalies.length > 0 ? anomalies.map(humanize).join(', ') : 'No discrete anomaly recorded';
  return {
    primary_finding: inv.root_cause
      ? `${rc} identified as the most probable root cause at ${Math.round((inv.confidence ?? 0) * 100)}% confidence.`
      : 'Root cause analysis was inconclusive; further review required.',
    detected_condition: condition,
    operational_impact: inv.severity
      ? `Assessed severity ${inv.severity} for ${sat.name} (${sat.mission}).`
      : 'Operational impact not yet assessed.',
    current_status: humanize(inv.status),
    required_human_action: recommendations[0]?.action ?? 'Authorized Mission Director review of the findings.',
  };
}

// ---------- Report completeness score (out of 100) ----------

/**
 * Deterministic report-completeness score, out of 100, computed from the actual
 * presence and richness of investigation data. This is NOT a fabricated value —
 * it reflects only what data exists. Category weights:
 *
 *   Data Completeness       (20) — telemetry sample (8) + satellite metadata (8) + health present (4)
 *   Evidence Coverage       (20) — min(evidenceCount,5)/5 × 20
 *   RCA Confidence          (15) — confidence × 15  (0 when RCA inconclusive)
 *   Traceability            (15) — agents min(n,6)/6 × 9 + timeline (3) + decision trace (3)
 *   Auditability            (10) — min(auditRows,5)/5 × 10
 *   Recommendation Quality  (10) — min(recs,3)/3 × 10
 *   Report Integrity        (10) — root cause (4) + severity (3) + safety statement (3)
 *
 * Each category is clamped to its max; the overall score is the rounded sum.
 */
export function computeCompleteness(args: {
  hasTelemetry: boolean;
  satellite: Satellite;
  healthPresent: boolean;
  evidenceCount: number;
  confidence: number | null;
  agentCount: number;
  timelineCount: number;
  decisionTraceCount: number;
  auditCount: number;
  recommendationCount: number;
  hasRootCause: boolean;
  hasSeverity: boolean;
  hasSafetyStatement: boolean;
}): ReportCompleteness {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

  const satMetaComplete = !!(args.satellite.name && args.satellite.mission && args.satellite.orbit_type && args.satellite.norad_id);
  const dataCompleteness = clamp((args.hasTelemetry ? 8 : 0) + (satMetaComplete ? 8 : 0) + (args.healthPresent ? 4 : 0), 20);
  const evidenceCoverage = clamp((Math.min(args.evidenceCount, 5) / 5) * 20, 20);
  const rcaConfidence = clamp((args.confidence ?? 0) * 15, 15);
  const traceability = clamp((Math.min(args.agentCount, 6) / 6) * 9 + (args.timelineCount > 0 ? 3 : 0) + (args.decisionTraceCount > 0 ? 3 : 0), 15);
  const auditability = clamp((Math.min(args.auditCount, 5) / 5) * 10, 10);
  const recommendationQuality = clamp((Math.min(args.recommendationCount, 3) / 3) * 10, 10);
  const reportIntegrity = clamp((args.hasRootCause ? 4 : 0) + (args.hasSeverity ? 3 : 0) + (args.hasSafetyStatement ? 3 : 0), 10);

  const categories: ReportCompletenessCategory[] = [
    { key: 'data_completeness', label: 'Data Completeness', score: Math.round(dataCompleteness), max: 20 },
    { key: 'evidence_coverage', label: 'Evidence Coverage', score: Math.round(evidenceCoverage), max: 20 },
    { key: 'rca_confidence', label: 'RCA Confidence', score: Math.round(rcaConfidence), max: 15 },
    { key: 'traceability', label: 'Traceability', score: Math.round(traceability), max: 15 },
    { key: 'auditability', label: 'Auditability', score: Math.round(auditability), max: 10 },
    { key: 'recommendation_quality', label: 'Recommendation Quality', score: Math.round(recommendationQuality), max: 10 },
    { key: 'report_integrity', label: 'Report Integrity', score: Math.round(reportIntegrity), max: 10 },
  ];

  const score = Math.round(
    dataCompleteness + evidenceCoverage + rcaConfidence + traceability + auditability + recommendationQuality + reportIntegrity,
  );
  return { score, max: 100, categories };
}
