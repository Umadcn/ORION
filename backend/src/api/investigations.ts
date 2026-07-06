import { Router } from 'express';
import { asyncHandler } from './errors.js';
import * as inv from '../services/investigationService.js';
import { runInvestigation } from '../orchestrator/investigationOrchestrator.js';
import { generateReport, getReportForInvestigation } from '../services/reportService.js';
import { requireRole } from '../auth/middleware.js';

const router = Router();

// Review/decision actions are Mission Director responsibilities.
const director = requireRole('MISSION_DIRECTOR');

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** Assemble the full investigation details payload for the UI. */
function details(id: number) {
  const investigation = inv.requireInvestigation(id);
  return {
    ...investigation,
    detected_anomalies: parseJson<string[]>(investigation.detected_anomalies, []),
    scoring_breakdown: parseJson(investigation.scoring_breakdown, []),
    evidence: inv.getEvidence(id).map((e) => ({
      ...e,
      details: parseJson(e.details, {}),
      supports_root_cause: !!e.supports_root_cause,
      cached: !!e.cached,
      fallback_used: !!e.fallback_used,
    })),
    recommendations: inv.getRecommendations(id),
    agent_executions: inv.getAgentExecutions(id),
    alerts: inv.getInvestigationAlerts(id),
    report: getReportForInvestigation(id) ?? null,
  };
}

// GET /api/investigations
router.get('/', (_req, res) => {
  const list = inv.listInvestigations().map((i) => ({
    ...i,
    detected_anomalies: parseJson<string[]>(i.detected_anomalies, []),
  }));
  res.json(list);
});

// GET /api/investigations/:id  (full details)
router.get('/:id', asyncHandler((req, res) => {
  res.json(details(Number(req.params.id)));
}));

router.get('/:id/agent-executions', asyncHandler((req, res) => {
  res.json(inv.getAgentExecutions(Number(req.params.id)));
}));

router.post('/:id/approve', director, asyncHandler((req, res) => {
  res.json(inv.approve(Number(req.params.id)));
}));

router.post('/:id/reject', director, asyncHandler((req, res) => {
  res.json(inv.reject(Number(req.params.id)));
}));

router.post('/:id/resolve', director, asyncHandler((req, res) => {
  res.json(inv.resolve(Number(req.params.id)));
}));

router.post('/:id/rerun-analysis', director, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  inv.requireInvestigation(id);
  const result = await runInvestigation(id);
  res.json({ ...result, investigation: details(id) });
}));

router.post('/:id/generate-report', director, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const report = await generateReport(id);
  res.status(201).json({ ...report, content: JSON.parse(report.content) });
}));

export default router;
