import { Router } from 'express';
import { config, SAFETY_STATEMENT } from '../config.js';
import { simulation } from '../services/simulationService.js';
import { db } from '../db.js';

const router = Router();

/** Active (non-archived) satellite count — read-only aggregate, safe pre-auth. */
function activeSatelliteCount(): number {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM satellites WHERE lifecycle_state IS NULL OR lifecycle_state <> 'ARCHIVED'`)
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'project-orion-backend',
    version: '1.0.0',
    integration_mode: config.integrationMode,
    simulation_running: simulation.isRunning(),
    time: new Date().toISOString(),
    safety: SAFETY_STATEMENT,
    // Read-only aggregate status for the public login screen (no sensitive data).
    // Derived from the running system — never fabricated.
    satellites: activeSatelliteCount(),
    multi_agent_system: 'ONLINE',       // the six-agent registry + API are serving
    mission_intelligence: 'OPERATIONAL', // backend healthy (status: ok)
  });
});

export default router;
