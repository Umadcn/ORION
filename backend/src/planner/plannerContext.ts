/**
 * Planner context: authoritative deterministic investigation facts (read-only).
 */
import { db } from '../db.js';
import { getEvidence, getInvestigation } from '../services/investigationService.js';
import { getReportForInvestigation } from '../services/reportService.js';
import { rootCauseToSubsystem } from '../generation/contextBuilder.js';
import type { Evidence, Investigation, Satellite } from '../types.js';

export interface PlannerContext {
  investigation: Investigation;
  satellite: Satellite | null;
  evidence: Evidence[];
  anomalyTypes: string[];
  subsystem: string | null;
  hasReport: boolean;
}

export function buildPlannerContext(investigationId: number): PlannerContext | null {
  const investigation = getInvestigation(investigationId);
  if (!investigation) return null;
  const satellite = (db.prepare('SELECT * FROM satellites WHERE id = ?').get(investigation.satellite_id) as Satellite | undefined) ?? null;
  const evidence = getEvidence(investigationId);
  let anomalyTypes: string[] = [];
  try { anomalyTypes = JSON.parse(investigation.detected_anomalies) as string[]; } catch { anomalyTypes = []; }
  return {
    investigation,
    satellite,
    evidence,
    anomalyTypes,
    subsystem: rootCauseToSubsystem(investigation.root_cause),
    hasReport: !!getReportForInvestigation(investigationId),
  };
}
