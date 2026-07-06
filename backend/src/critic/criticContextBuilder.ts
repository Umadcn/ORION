/**
 * Deterministic, bounded, READ-ONLY Critic context builder (Phase 7).
 *
 * Given a Planner execution id, it loads the authoritative deterministic facts
 * for that investigation and reconstructs the Planner analysis (deterministically
 * re-run) to review. Context is bounded and stable-ordered; it contains NO
 * secrets, NO Authorization headers, NO raw prompts, NO hidden reasoning, NO raw
 * vectors, and NO unrelated investigations. Trusted (authoritative) and untrusted
 * (retrieved) sources are clearly separated.
 */
import { db } from '../db.js';
import { config } from '../config.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import { buildPlannerContext } from '../planner/plannerContext.js';
import type { PlannerService } from '../planner/plannerService.js';
import type { Role } from '../auth/users.js';
import type { CriticContext, CriticCitation, CriticEvidenceItem } from './types.js';

export interface CriticContextDeps {
  plannerService: PlannerService;
}

export interface PlannerExecutionRow {
  id: number;
  investigation_id: number;
  correlation_id: string;
}

/** Load the stored planner execution row (audit). Returns undefined if unknown. */
export function getPlannerExecutionRow(plannerExecutionId: number): PlannerExecutionRow | undefined {
  return db.prepare('SELECT id, investigation_id, correlation_id FROM planner_executions WHERE id = ?').get(plannerExecutionId) as PlannerExecutionRow | undefined;
}

export interface BuildCriticContextParams {
  plannerExecutionId: number;
  userId: string;
  role: Role;
}

export async function buildCriticContext(params: BuildCriticContextParams, deps: CriticContextDeps): Promise<CriticContext | null> {
  const row = getPlannerExecutionRow(params.plannerExecutionId);
  if (!row) return null;

  const investigationId = row.investigation_id;
  const pctx = buildPlannerContext(investigationId);
  if (!pctx) return null;

  // Deterministically reconstruct the Planner analysis under review (read-only).
  const planner = await deps.plannerService.analyze({ investigationId, userId: params.userId, role: params.role });
  const analysis = planner.analysis;
  if (!analysis) return null;

  const inv = pctx.investigation;
  const satelliteId = inv.satellite_id;

  // --- Deterministic evidence (trusted). ---
  const maxEvidence = config.generation.maxEvidenceItems;
  const evidence: CriticEvidenceItem[] = pctx.evidence.slice(0, maxEvidence).map((e) => ({
    evidence_id: String(e.id),
    summary: (e.summary ?? '').slice(0, 300),
    supports_root_cause: !!e.supports_root_cause,
    reliability_score: Number(e.reliability_score ?? 0),
  }));

  // --- Retrieved mission knowledge (UNTRUSTED) with resolvable text. ---
  const citations: CriticCitation[] = [];
  for (const c of planner.citations.slice(0, config.generation.maxRetrievalChunks)) {
    const resolved = resolveCitation(c.citationId);
    citations.push({ citation_id: c.citationId, title: c.title, document_id: c.documentId, text: (resolved?.chunk.content ?? '').slice(0, 500) });
  }

  // --- Deterministic tool facts (telemetry / alerts / historical). ---
  const telRow = db.prepare('SELECT temperature_c, battery_percent, signal_strength_dbm, power_consumption_w FROM telemetry WHERE satellite_id = ? ORDER BY id DESC LIMIT 1').get(satelliteId) as
    | { temperature_c: number; battery_percent: number; signal_strength_dbm: number; power_consumption_w: number }
    | undefined;
  const telemetryLatest = telRow
    ? { temperature_c: telRow.temperature_c, battery_percent: telRow.battery_percent, signal_strength_dbm: telRow.signal_strength_dbm, power_consumption_w: telRow.power_consumption_w }
    : null;
  const alertsActiveCount = (db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE satellite_id = ? AND status = 'ACTIVE'").get(satelliteId) as { c: number }).c;
  const historicalCount = (db.prepare('SELECT COUNT(*) AS c FROM investigations WHERE satellite_id = ? AND id <> ? AND root_cause IS NOT NULL').get(satelliteId, investigationId) as { c: number }).c;

  // --- Which sources the Planner actually inspected (from step summaries). ---
  const ran = (type: string) => planner.stepSummaries.some((s) => s.stepType === type && (s.status === 'SUCCESS' || s.status === 'INTERNAL'));

  // --- Known IDs (for fabrication detection). ---
  const knownSatelliteIdsUpper = (db.prepare('SELECT id FROM satellites').all() as { id: string }[]).map((r) => r.id.toUpperCase());
  const knownInvestigationIds = (db.prepare('SELECT id FROM investigations').all() as { id: number }[]).map((r) => r.id);
  const knownReportIds = (db.prepare('SELECT id FROM reports').all() as { id: number }[]).map((r) => r.id);

  const plannerKnowledgeGaps = planner.knowledgeGaps.filter((g) => !g.sufficient).map((g) => g.description);

  return {
    investigationId,
    satelliteId,
    authoritativeRootCause: inv.root_cause ?? 'UNKNOWN_ANOMALY',
    deterministicConfidence: inv.confidence ?? null,
    investigationStatus: inv.status,
    severity: inv.severity ?? null,
    subsystem: pctx.subsystem,
    anomalyTypes: pctx.anomalyTypes,
    evidence,
    telemetryPresent: telemetryLatest !== null,
    telemetryInspected: ran('INSPECT_TELEMETRY'),
    telemetryLatest,
    alertsActiveCount,
    alertsInspected: ran('INSPECT_ALERTS'),
    missionKnowledgeInspected: ran('SEARCH_MISSION_KNOWLEDGE'),
    historicalInspected: ran('SEARCH_HISTORICAL_INVESTIGATIONS'),
    historicalCount,
    citations,
    knownSatelliteIdsUpper,
    knownInvestigationIds,
    knownReportIds,
    plannerExecutionId: planner.plannerExecutionId,
    plannerCorrelationId: planner.correlationId,
    plannerExecutionMode: planner.executionMode,
    plannerPlanStatus: planner.planStatus,
    plannerKnowledgeGaps,
    analysis,
  };
}
