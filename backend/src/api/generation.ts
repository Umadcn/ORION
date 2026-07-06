/**
 * Read-only grounded-generation audit API (Phase 4).
 * RBAC: Mission Director + System Administrator only. Rows contain no prompts,
 * no raw retrieved chunks, no raw model responses, no secrets, no embeddings.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { requireRole } from '../auth/middleware.js';
import { generationRepo } from '../generation/repository.js';

const router = Router();
router.use(requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'));

const numOrUndef = (v: unknown): number | undefined =>
  v !== undefined && v !== null && v !== '' ? Number(v) : undefined;

// GET /api/generation/executions — bounded, filtered, paginated.
router.get('/executions', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(
    generationRepo.list({
      investigationId: numOrUndef(q.investigation_id),
      status: q.status,
      useCase: q.use_case,
      limit: numOrUndef(q.limit),
      offset: numOrUndef(q.offset),
    }),
  );
});

// GET /api/generation/executions/:id
router.get(
  '/executions/:id',
  asyncHandler((req, res) => {
    const rec = generationRepo.getById(Number(req.params.id));
    if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Generation execution not found' });
    return res.json(rec);
  }),
);

export default router;
