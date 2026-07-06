import { Router } from 'express';
import { config } from '../config.js';
import { getThresholds, resetThresholds, updateThresholds } from '../services/settingsService.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../analysis/anomalyRules.js';
import { requireRole } from '../auth/middleware.js';

const router = Router();

// Threshold changes are owned by Mission Director or System Administrator.
const canEditSettings = requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN');

router.get('/thresholds', (_req, res) => {
  res.json({
    thresholds: getThresholds(),
    defaults: DEFAULT_THRESHOLDS,
    integration_mode: config.integrationMode,
  });
});

router.put('/thresholds', canEditSettings, (req, res) => {
  const body = (req.body ?? {}) as Partial<Thresholds>;
  const numericKeys: (keyof Thresholds)[] = [
    'high_temperature_c',
    'low_battery_percent',
    'comm_loss_dbm',
    'abnormal_power_w',
    'orbit_deviation_km',
    'min_persisted_samples',
  ];
  const clean: Partial<Thresholds> = {};
  for (const k of numericKeys) {
    if (body[k] !== undefined) {
      const val = Number(body[k]);
      if (!Number.isFinite(val)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: `${k} must be a number` });
      }
      clean[k] = val;
    }
  }
  const updated = updateThresholds(clean);
  return res.json({ thresholds: updated });
});

router.post('/thresholds/reset', canEditSettings, (_req, res) => {
  res.json({ thresholds: resetThresholds() });
});

export default router;
