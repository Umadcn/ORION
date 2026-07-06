import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { db } from '../db.js';
import { acknowledgeAlert } from '../services/anomalyService.js';
import { requireRole } from '../auth/middleware.js';
import type { Alert } from '../types.js';

const router = Router();

// GET /api/alerts?status=ACTIVE&satellite_id=ORION-3&anomaly_type=LOW_BATTERY
router.get('/', (req, res) => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const { status, satellite_id, anomaly_type } = req.query as Record<string, string>;
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (satellite_id) { clauses.push('satellite_id = ?'); params.push(satellite_id); }
  if (anomaly_type) { clauses.push('anomaly_type = ?'); params.push(anomaly_type); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM alerts ${where} ORDER BY id DESC`).all(...params) as Alert[];
  res.json(rows);
});

router.get(
  '/:id',
  asyncHandler((req, res) => {
    const row = db.prepare('SELECT * FROM alerts WHERE id = ?').get(Number(req.params.id)) as Alert | undefined;
    if (!row) return res.status(404).json({ error: 'NOT_FOUND', message: 'Alert not found' });
    return res.json(row);
  }),
);

router.post(
  '/:id/acknowledge',
  requireRole('MISSION_DIRECTOR'),
  asyncHandler((req, res) => {
    const updated = acknowledgeAlert(Number(req.params.id));
    if (!updated) return res.status(404).json({ error: 'NOT_FOUND', message: 'Alert not found' });
    return res.json(updated);
  }),
);

export default router;
