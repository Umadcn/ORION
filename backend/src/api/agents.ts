import { Router } from 'express';
import { AGENT_CATALOG } from '../agents/base.js';
import { db } from '../db.js';
import type { AgentExecution } from '../types.js';

const router = Router();

// GET /api/agents — static catalog of the six agents.
router.get('/', (_req, res) => {
  res.json(AGENT_CATALOG);
});

// GET /api/agents/executions?limit=50 — recent executions across all investigations.
router.get('/executions', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 500);
  const rows = db
    .prepare(`SELECT * FROM agent_executions ORDER BY id DESC LIMIT ?`)
    .all(limit) as AgentExecution[];
  res.json(rows);
});

export default router;
