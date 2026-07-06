/**
 * Bounded Planner Agent API (Phase 6). READ-ONLY analysis assistance.
 *
 * POST /api/investigations/:id/planner-analysis accepts NO arbitrary prompt,
 * plan, tools, provider/model, or retrieval query — the request body is ignored.
 * It never mutates mission state. Audit endpoints are Director/Admin read-only.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { requireRole } from '../auth/middleware.js';
import type { AuthedRequest } from '../auth/middleware.js';
import { plannerService } from '../planner/plannerService.js';
import { getPlannerExecution, listPlannerExecutions } from '../planner/plannerAuditRepository.js';
import type { Role } from '../auth/users.js';

const numOrUndef = (v: unknown): number | undefined => (v !== undefined && v !== null && v !== '' ? Number(v) : undefined);

// --- Read-only analysis endpoint (mounted under /api/investigations). ---
export const plannerInvestigationRouter = Router();
plannerInvestigationRouter.post(
  '/:id/planner-analysis',
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid investigation id' });
    const result = await plannerService.analyze({ investigationId: id, userId: req.user!.sub, role: req.user!.role as Role });
    return res.json(result);
  }),
);

// --- Director/Admin read-only audit endpoints (mounted under /api/planner). ---
export const plannerAuditRouter = Router();
plannerAuditRouter.use(requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'));
plannerAuditRouter.get('/executions', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(listPlannerExecutions({ investigationId: numOrUndef(q.investigation_id), status: q.status, limit: numOrUndef(q.limit), offset: numOrUndef(q.offset) }));
});
plannerAuditRouter.get(
  '/executions/:id',
  asyncHandler((req, res) => {
    const rec = getPlannerExecution(Number(req.params.id));
    if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Planner execution not found' });
    return res.json(rec);
  }),
);
