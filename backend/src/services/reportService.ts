/**
 * Report service: assembles the report input from persisted investigation data,
 * runs the Report Generation Agent, and stores the resulting report.
 */
import { db, now } from '../db.js';
import { ReportGenerationAgent, type InvestigationReport } from '../agents/reportGenerationAgent.js';
import { getSatellite } from './telemetryService.js';
import * as inv from './investigationService.js';
import type { Report } from '../types.js';

export class ReportError extends Error {}

export async function generateReport(investigationId: number): Promise<Report> {
  const investigation = inv.requireInvestigation(investigationId);
  const satellite = getSatellite(investigation.satellite_id);
  if (!satellite) throw new ReportError(`Satellite ${investigation.satellite_id} not found`);

  const input = {
    investigation,
    satellite,
    alerts: inv.getInvestigationAlerts(investigationId),
    evidence: inv.getEvidence(investigationId),
    recommendations: inv.getRecommendations(investigationId),
    agentExecutions: inv.getAgentExecutions(investigationId),
  };

  const run = await new ReportGenerationAgent().run(input, { investigationId });
  if (!run.output) throw new ReportError('Report generation failed');
  const report: InvestigationReport = run.output;

  const info = db
    .prepare(`INSERT INTO reports (investigation_id, title, content, created_at) VALUES (?, ?, ?, ?)`)
    .run(investigationId, report.title, JSON.stringify(report), now());

  return getReport(Number(info.lastInsertRowid))!;
}

export function getReport(id: number): Report | undefined {
  return db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as Report | undefined;
}

export function listReports(): Report[] {
  return db.prepare(`SELECT * FROM reports ORDER BY id DESC`).all() as Report[];
}

/**
 * Audit-ready report index: report metadata enriched with the parent
 * investigation's satellite, root cause, confidence, severity, and status.
 * Additive helper for the Reports archive view — reads existing data only.
 */
export interface ReportSummary {
  id: number;
  investigation_id: number;
  title: string;
  created_at: string;
  satellite_id: string | null;
  root_cause: string | null;
  confidence: number | null;
  severity: string | null;
  investigation_status: string | null;
}

export function listReportSummaries(): ReportSummary[] {
  return db
    .prepare(
      `SELECT r.id, r.investigation_id, r.title, r.created_at,
              i.satellite_id, i.root_cause, i.confidence, i.severity,
              i.status AS investigation_status
         FROM reports r
         LEFT JOIN investigations i ON i.id = r.investigation_id
        ORDER BY r.id DESC`,
    )
    .all() as ReportSummary[];
}

export function getReportForInvestigation(investigationId: number): Report | undefined {
  return db
    .prepare(`SELECT * FROM reports WHERE investigation_id = ? ORDER BY id DESC LIMIT 1`)
    .get(investigationId) as Report | undefined;
}
