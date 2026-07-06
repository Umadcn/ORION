/**
 * Read-only investigation briefing API (Phase 4).
 *
 * POST /api/investigations/:id/briefing generates a grounded, read-only briefing.
 * It accepts NO arbitrary prompt, system prompt, retrieval query, provider,
 * model, or tools — the request body is ignored. It never mutates investigation
 * state. RBAC matches investigation read access (any authenticated role).
 *
 * Mounted after the investigations router at the same base, so it only handles
 * the /:id/briefing path and never shadows existing investigation routes.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import type { AuthedRequest } from '../auth/middleware.js';
import { briefingService } from '../briefing/briefingService.js';

const router = Router();

// POST /api/investigations/:id/briefing — generate a read-only grounded briefing.
router.post(
  '/:id/briefing',
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid investigation id' });
    }
    const response = await briefingService.generateBriefing(id, req.user?.sub ?? null);
    return res.json(response);
  }),
);

export default router;
