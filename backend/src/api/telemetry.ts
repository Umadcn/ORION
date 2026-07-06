import { Router } from 'express';
import { getLatestForAll, getRecentTelemetry } from '../services/telemetryService.js';

const router = Router();

// GET /api/telemetry?satellite_id=ORION-3&limit=60
router.get('/', (req, res) => {
  const satelliteId = req.query.satellite_id as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 60), 500);
  if (satelliteId) {
    return res.json(getRecentTelemetry(satelliteId, limit));
  }
  return res.json(getLatestForAll());
});

// GET /api/telemetry/latest
router.get('/latest', (_req, res) => {
  res.json(getLatestForAll());
});

export default router;
