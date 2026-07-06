/**
 * Bounded Critic Agent API (Phase 7). READ-ONLY analysis-quality review.
 *
 * POST /api/planner/executions/:id/critic-review accepts NO arbitrary prompt,
 * NO arbitrary CriticReview, NO arbitrary revised analysis, and NO provider/model
 * override — the request body is ignored. It never mutates mission state.
 * Audit endpoints are Director/Admin read-only.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { requireRole } from '../auth/middleware.js';
import type { AuthedRequest } from '../auth/middleware.js';
import { criticService } from '../critic/criticService.js';
import { getCriticExecution, listCriticExecutions } from '../critic/criticAuditRepository.js';
import type { Role } from '../auth/users.js';

const numOrUndef = (v: unknown): number | undefined => (v !== undefined && v !== null && v !== '' ? Number(v) : undefined);

// --- Read-only review endpoint (mounted under /api/planner, any authenticated role). ---
export const criticReviewRouter = Router();
criticReviewRouter.post(
  '/executions/:id/critic-review',
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid planner execution id' });
    const result = await criticService.review({ plannerExecutionId: id, userId: req.user!.sub, role: req.user!.role as Role });
    return res.json(result);
  }),
);

// --- Director/Admin read-only audit endpoints (mounted under /api/critic). ---
export const criticAuditRouter = Router();
criticAuditRouter.use(requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'));
criticAuditRouter.get('/executions', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(listCriticExecutions({ investigationId: numOrUndef(q.investigation_id), plannerExecutionId: numOrUndef(q.planner_execution_id), decision: q.decision, limit: numOrUndef(q.limit), offset: numOrUndef(q.offset) }));
});
criticAuditRouter.get(
  '/executions/:id',
  asyncHandler((req, res) => {
    const rec = getCriticExecution(Number(req.params.id));
    if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Critic execution not found' });
    return res.json(rec);
  }),
);
