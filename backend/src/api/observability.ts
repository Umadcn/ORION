/**
 * Read-only AI Observability, Evaluation & Governance API (Phase 8).
 *
 * ALL routes are Director/Admin only and strictly read-only. No arbitrary SQL,
 * no arbitrary table/column selection, no prompt/provider/model/query override.
 * `range` is allowlisted (24H|7D|30D|ALL); time-series `metric` is allowlisted.
 * Responses contain only bounded aggregates — never raw prompts, raw model
 * responses, secrets, Authorization headers, raw vectors, or unrestricted payloads.
 */
import { Router } from 'express';
import { requireRole } from '../auth/middleware.js';
import { config } from '../config.js';
import { parseRange } from '../observability/aggregation.js';
import { observabilityService, isValidTimeseriesMetric, TIMESERIES_METRICS } from '../observability/observabilityService.js';

const router = Router();

// Director/Admin only for the entire observability surface.
router.use(requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'));

const range = (req: { query: Record<string, unknown> }) => parseRange((req.query as Record<string, string>).range, config.observability.defaultRange);

router.get('/status', (_req, res) => res.json(observabilityService.status()));
router.get('/overview', (req, res) => res.json(observabilityService.getOverview(range(req))));
router.get('/llm', (req, res) => res.json(observabilityService.buildSnapshot(range(req)).llm));
router.get('/retrieval', (req, res) => res.json(observabilityService.buildSnapshot(range(req)).retrieval));
router.get('/generation', (req, res) => res.json(observabilityService.buildSnapshot(range(req)).generation));
router.get('/copilot', (req, res) => res.json(observabilityService.buildSnapshot(range(req)).copilot));
router.get('/planner', (req, res) => res.json(observabilityService.buildSnapshot(range(req)).planner));
router.get('/critic', (req, res) => res.json(observabilityService.buildSnapshot(range(req)).critic));
router.get('/governance', (req, res) => res.json(observabilityService.getGovernance(range(req))));
router.get('/evaluations', (_req, res) => res.json(observabilityService.getEvaluations()));
router.get('/snapshot', (req, res) => res.json(observabilityService.buildSnapshot(range(req))));

router.get('/timeseries', (req, res) => {
  const metric = (req.query as Record<string, string>).metric;
  if (!isValidTimeseriesMetric(metric)) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Unknown or missing time-series metric', allowed: TIMESERIES_METRICS });
  }
  return res.json(observabilityService.getTimeseries(metric, range(req)));
});

export default router;
