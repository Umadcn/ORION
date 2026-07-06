/**
 * Read-only LLM observability/audit API (Phase 1).
 * RBAC: Mission Director + System Administrator only. No secrets are ever
 * returned (config exposes booleans/numbers; audit rows store no credentials).
 * There is intentionally NO endpoint to submit arbitrary prompts.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { requireRole } from '../auth/middleware.js';
import { config, describeLlmConfig, isRealLlmConfigured } from '../config.js';
import { buildRealProvider } from '../llm/httpProvider.js';
import { getLlmExecution, listLlmExecutions } from '../services/llmAuditService.js';

const router = Router();

// Whole router is ops-only.
router.use(requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'));

// GET /api/llm/status — non-secret configuration + operating mode + availability.
router.get('/status', (_req, res) => {
  const real = buildRealProvider();
  const operatingMode = isRealLlmConfigured()
    ? 'REAL_PROVIDER'
    : config.llm.fallbackEnabled
    ? 'DETERMINISTIC_FALLBACK'
    : 'DISABLED';
  res.json({
    ...describeLlmConfig(),
    provider_available: real ? real.isAvailable() : false,
    fallback_provider: 'deterministic-fallback',
    operating_mode: operatingMode,
  });
});

// GET /api/llm/executions — bounded, filtered, paginated audit list.
router.get('/executions', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const result = listLlmExecutions({
    provider: q.provider,
    model: q.model,
    mode: q.mode,
    status: q.status,
    investigationId: q.investigation_id !== undefined ? Number(q.investigation_id) : undefined,
    since: q.since,
    until: q.until,
    limit: q.limit !== undefined ? Number(q.limit) : undefined,
    offset: q.offset !== undefined ? Number(q.offset) : undefined,
  });
  res.json(result);
});

// GET /api/llm/executions/:id
router.get(
  '/:id',
  asyncHandler((req, res) => {
    const rec = getLlmExecution(Number(req.params.id));
    if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Execution not found' });
    return res.json(rec);
  }),
);

export default router;
