/**
 * Agent 6 — Report Generation Agent.
 * Generates a structured, printable investigation report from a completed
 * investigation. Pulls scientific references from the OpenAlex adapter
 * (offline fixture) for report context. Not on the critical detection path.
 */
import { BaseAgent } from './base.js';
import { getReferencesFor } from '../integrations/openalex.js';
import { SAFETY_STATEMENT } from '../config.js';
import type { Thresholds } from '../analysis/anomalyRules.js';
import {
  buildAgents,
  buildAnomalies,
  buildAuditTrail,
  buildDecisionTrace,
  buildExecutiveSummary,
  buildRca,
  buildReview,
  buildRisk,
  buildTelemetrySnapshot,
  buildTransparency,
  computeCompleteness,
  type ReportAgentDetail,
  type ReportAnomalyRow,
  type ReportAuditRow,
  type ReportCompleteness,
  type ReportExecutiveSummary,
  type ReportRca,
  type ReportReview,
  type ReportRiskRow,
  type ReportSystemTransparency,
  type ReportTelemetryMetric,
} from '../services/reportComposer.js';
import type {
  AgentExecution,
  AgentStatus,
  Alert,
  Evidence,
  Investigation,
  Recommendation,
  Satellite,
  Telemetry,
} from '../types.js';

export interface ReportInput {
  investigation: Investigation;
  satellite: Satellite;
  alerts: Alert[];
  evidence: Evidence[];
  recommendations: Recommendation[];
  agentExecutions: AgentExecution[];
  /** Latest telemetry sample for the satellite (null when none exists). */
  latestTelemetry?: Telemetry | null;
  /** Active anomaly thresholds at report time (for expected-range display). */
  thresholds: Thresholds;
}

export interface InvestigationReport {
  title: string;
  generated_at: string;
  safety_statement: string;
  incident_summary: string;
  satellite: {
    id: string;
    name: string;
    mission: string;
    orbit_type: string;
    norad_id: string;
  };
  timeline: { time: string; event: string }[];
  detected_anomalies: string[];
  telemetry_evidence: { summary: string; source_name: string }[];
  space_weather_evidence: Evidence | null;
  orbit_evidence: Evidence | null;
  agent_execution_history: {
    agent_name: string;
    status: string;
    duration_ms: number | null;
    output_summary: string;
  }[];
  root_cause: string | null;
  confidence: number | null;
  severity: string | null;
  explanation: string | null;
  scoring_breakdown: unknown;
  recommendations: { action: string; rationale: string; priority: string }[];
  mission_director_decision: string;
  reviewed_at: string | null;
  resolution: string;
  resolved_at: string | null;
  references: { title: string; host_venue: string; publication_year: number }[];
  provenance: {
    source_name: string;
    source_url: string;
    mode: string;
    cached: boolean;
    fallback_used: boolean;
  }[];

  // ---- Professional structured sections (additive; older reports may omit) ----
  investigation_id: number;
  report_status: string;
  classification: string;
  satellite_health: number | null;
  detection_time: string | null;
  investigation_started_at: string;
  investigation_completed_at: string | null;
  executive_summary: ReportExecutiveSummary;
  telemetry_snapshot: ReportTelemetryMetric[];
  telemetry_snapshot_time: string | null;
  anomalies_detail: ReportAnomalyRow[];
  rca: ReportRca;
  agents_detail: ReportAgentDetail[];
  decision_trace: string[];
  risk_assessment: ReportRiskRow[];
  audit_trail: ReportAuditRow[];
  system_transparency: ReportSystemTransparency;
  completeness: ReportCompleteness;
  review: ReportReview;
}

export class ReportGenerationAgent extends BaseAgent<ReportInput, InvestigationReport> {
  readonly agent_id = 'report-generation';
  readonly name = 'Report Generation Agent';
  readonly description = 'Generates the structured, printable investigation report.';

  private fallback = false;

  protected summarizeInput(i: ReportInput): string {
    return `Investigation #${i.investigation.id} (${i.satellite.id})`;
  }
  protected summarizeOutput(r: InvestigationReport): string {
    return `Report generated: ${r.title}`;
  }
  protected statusFromOutput(): AgentStatus {
    return this.fallback ? 'FALLBACK_USED' : 'COMPLETED';
  }

  async execute(input: ReportInput): Promise<InvestigationReport> {
    const { investigation: inv, satellite: sat, alerts, evidence, recommendations, agentExecutions } = input;

    const rootCause = inv.root_cause ?? 'UNKNOWN_ANOMALY';
    const research = await getReferencesFor(rootCause);
    this.fallback = research.provenance.fallback_used;

    const anomalies = safeJson<string[]>(inv.detected_anomalies, []);
    const latestTelemetry = input.latestTelemetry ?? null;
    const thresholds = input.thresholds;
    const healthScore = typeof sat.health_score === 'number' ? sat.health_score : null;

    // --- Deterministic professional sections (derived only from real data) ---
    const executiveSummary = buildExecutiveSummary(inv, sat, anomalies, recommendations);
    const telemetrySnapshot = buildTelemetrySnapshot(latestTelemetry, thresholds, healthScore);
    const anomaliesDetail = buildAnomalies(alerts, anomalies, latestTelemetry, thresholds);
    const rcaSection = buildRca(inv, evidence);
    const agentsDetail = buildAgents(agentExecutions, inv.confidence);
    const decisionTrace = buildDecisionTrace();
    const riskAssessment = buildRisk(inv, recommendations);
    const auditTrail = buildAuditTrail(inv, alerts, agentExecutions);
    const anyAgentFallback = agentExecutions.some((e) => e.status === 'FALLBACK_USED');
    const systemTransparency = buildTransparency(this.fallback, anyAgentFallback);
    const review = buildReview(inv);
    const detectionTime = alerts.length > 0 ? alerts[0].created_at : null;
    const completedAt = inv.resolved_at ?? inv.reviewed_at ?? null;
    const completeness = computeCompleteness({
      hasTelemetry: !!latestTelemetry,
      satellite: sat,
      healthPresent: healthScore != null,
      evidenceCount: evidence.length,
      confidence: inv.confidence,
      agentCount: agentExecutions.length,
      timelineCount: 1 + alerts.length,
      decisionTraceCount: decisionTrace.length,
      auditCount: auditTrail.length,
      recommendationCount: recommendations.length,
      hasRootCause: !!inv.root_cause,
      hasSeverity: !!inv.severity,
      hasSafetyStatement: true,
    });

    const timeline: { time: string; event: string }[] = [
      { time: inv.created_at, event: `Investigation opened for ${sat.id}` },
    ];
    for (const a of alerts) {
      timeline.push({ time: a.created_at, event: `Alert: ${a.anomaly_type} (${a.severity})` });
    }
    if (inv.reviewed_at) timeline.push({ time: inv.reviewed_at, event: `Mission Director decision: ${inv.review_decision}` });
    if (inv.resolved_at) timeline.push({ time: inv.resolved_at, event: 'Investigation resolved' });
    timeline.sort((a, b) => a.time.localeCompare(b.time));

    const spaceWeatherEv = evidence.find((e) => e.source_type === 'SPACE_WEATHER') ?? null;
    const orbitEv = evidence.find((e) => e.source_type === 'ORBIT_DATA') ?? null;
    const telemetryEv = evidence
      .filter((e) => e.source_type === 'TELEMETRY' || e.source_type === 'ANOMALY_RULE')
      .map((e) => ({ summary: e.summary, source_name: e.source_name }));

    const provenance = dedupeProvenance(
      evidence
        .filter((e) => e.mode)
        .map((e) => ({
          source_name: e.source_name,
          source_url: e.source_url ?? '',
          mode: e.mode as string,
          cached: !!e.cached,
          fallback_used: !!e.fallback_used,
        }))
        .concat([
          {
            source_name: research.provenance.source_name,
            source_url: research.provenance.source_url,
            mode: research.provenance.mode,
            cached: research.provenance.cached,
            fallback_used: research.provenance.fallback_used,
          },
        ]),
    );

    return {
      title: `Investigation Report — ${inv.title}`,
      generated_at: new Date().toISOString(),
      safety_statement: SAFETY_STATEMENT,
      incident_summary:
        `Investigation #${inv.id} concerns ${sat.name} (${sat.mission}, ${sat.orbit_type}). ` +
        `${anomalies.length} anomaly type(s) were detected: ${anomalies.join(', ') || 'none'}. ` +
        (inv.root_cause
          ? `The Root Cause Analysis Agent concluded ${inv.root_cause} at ${Math.round((inv.confidence ?? 0) * 100)}% confidence (${inv.severity}).`
          : 'Root cause analysis was inconclusive.'),
      satellite: { id: sat.id, name: sat.name, mission: sat.mission, orbit_type: sat.orbit_type, norad_id: sat.norad_id },
      timeline,
      detected_anomalies: anomalies,
      telemetry_evidence: telemetryEv,
      space_weather_evidence: spaceWeatherEv,
      orbit_evidence: orbitEv,
      agent_execution_history: agentExecutions.map((e) => ({
        agent_name: e.agent_name,
        status: e.status,
        duration_ms: e.duration_ms,
        output_summary: e.output_summary,
      })),
      root_cause: inv.root_cause,
      confidence: inv.confidence,
      severity: inv.severity,
      explanation: inv.explanation,
      scoring_breakdown: safeJson(inv.scoring_breakdown ?? '[]', []),
      recommendations: recommendations.map((r) => ({ action: r.action, rationale: r.rationale, priority: r.priority })),
      mission_director_decision: inv.review_decision ?? 'PENDING',
      reviewed_at: inv.reviewed_at,
      resolution: inv.status === 'RESOLVED' ? 'Investigation resolved.' : `Current status: ${inv.status}.`,
      resolved_at: inv.resolved_at,
      references: research.references.map((r) => ({ title: r.title, host_venue: r.host_venue, publication_year: r.publication_year })),
      provenance,

      // ---- Professional structured sections ----
      investigation_id: inv.id,
      report_status: inv.status === 'RESOLVED' || inv.status === 'APPROVED' || inv.status === 'REJECTED' ? 'FINAL' : 'PROVISIONAL',
      classification: 'CONFIDENTIAL — INTERNAL USE',
      satellite_health: healthScore,
      detection_time: detectionTime,
      investigation_started_at: inv.created_at,
      investigation_completed_at: completedAt,
      executive_summary: executiveSummary,
      telemetry_snapshot: telemetrySnapshot,
      telemetry_snapshot_time: latestTelemetry?.timestamp ?? null,
      anomalies_detail: anomaliesDetail,
      rca: rcaSection,
      agents_detail: agentsDetail,
      decision_trace: decisionTrace,
      risk_assessment: riskAssessment,
      audit_trail: auditTrail,
      system_transparency: systemTransparency,
      completeness,
      review,
    };
  }
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
function dedupeProvenance<T extends { source_name: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter((p) => {
    if (seen.has(p.source_name)) return false;
    seen.add(p.source_name);
    return true;
  });
}
