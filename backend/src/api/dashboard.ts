import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { db } from '../db.js';
import { getAllSatellites, getRecentTelemetry } from '../services/telemetryService.js';
import { serializeSatellite } from '../services/satelliteStatus.js';
import { getSpaceWeather } from '../integrations/noaaSwpc.js';
import { simulation } from '../services/simulationService.js';
import type { Alert, Investigation, Satellite } from '../types.js';

const router = Router();

// GET /api/dashboard/summary — all KPI values derived from the database.
router.get('/summary', (_req, res) => {
  // Serialize so fleet counts + system health use the EFFECTIVE (manual-aware) status.
  const satellites = getAllSatellites().map(serializeSatellite);
  const healthy = satellites.filter((s) => s.status === 'HEALTHY').length;
  const activeAlerts = (db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE status = 'ACTIVE'`).get() as { c: number }).c;
  const activeInvestigations = (
    db.prepare(`SELECT COUNT(*) AS c FROM investigations WHERE status NOT IN ('RESOLVED','REJECTED')`).get() as { c: number }
  ).c;

  res.json({
    total_satellites: satellites.length,
    healthy_satellites: healthy,
    healthy_percent: satellites.length ? Math.round((healthy / satellites.length) * 100) : 0,
    active_alerts: activeAlerts,
    active_investigations: activeInvestigations,
    system_uptime_percent: 99.82, // static presentation metric (documented as such)
    system_health: activeAlerts > 0 || healthy < satellites.length ? 'DEGRADED' : 'OPERATIONAL',
    simulation_running: simulation.isRunning(),
    satellites,
  });
});

// GET /api/dashboard/telemetry?satellite_id=ORION-3&limit=60
router.get('/telemetry', (req, res) => {
  const satelliteId = (req.query.satellite_id as string) || pickFocusSatellite();
  const limit = Math.min(Number(req.query.limit ?? 60), 300);
  res.json({ satellite_id: satelliteId, samples: getRecentTelemetry(satelliteId, limit) });
});

// GET /api/dashboard/recent-alerts
router.get('/recent-alerts', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM alerts ORDER BY id DESC LIMIT 8`).all() as Alert[];
  res.json(rows);
});

// GET /api/dashboard/investigations — active investigations with progress stage.
router.get('/investigations', (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM investigations ORDER BY id DESC LIMIT 8`)
    .all() as Investigation[];
  res.json(rows.map((i) => ({ ...i, detected_anomalies: safeArr(i.detected_anomalies) })));
});

// GET /api/dashboard/insights — latest RCA results as "AI mission insights".
router.get('/insights', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM investigations WHERE root_cause IS NOT NULL ORDER BY updated_at DESC LIMIT 5`,
    )
    .all() as Investigation[];
  res.json(
    rows.map((i) => ({
      investigation_id: i.id,
      satellite_id: i.satellite_id,
      title: i.title,
      root_cause: i.root_cause,
      confidence: i.confidence,
      severity: i.severity,
      explanation: i.explanation,
      status: i.status,
    })),
  );
});

// GET /api/dashboard/space-weather — offline space-weather summary for the widget.
router.get(
  '/space-weather',
  asyncHandler(async (_req, res) => {
    const sw = await getSpaceWeather();
    res.json({
      kp_index: sw.kp_index,
      condition: sw.geomagnetic_condition,
      label: sw.kp_index < 4 ? 'QUIET' : sw.kp_index < 5 ? 'UNSETTLED' : 'STORM',
      solar_activity: sw.solar_activity,
      commentary: sw.commentary,
      mode: sw.provenance.mode,
      source_name: sw.provenance.source_name,
      source_url: sw.provenance.source_url,
    });
  }),
);

function pickFocusSatellite(): string {
  // Prefer a satellite with an open investigation, else the least healthy active
  // satellite that actually has telemetry, else any satellite. Fully dynamic — no
  // hardcoded fixture id.
  const open = db
    .prepare(`SELECT satellite_id FROM investigations WHERE status NOT IN ('RESOLVED','REJECTED') ORDER BY id DESC LIMIT 1`)
    .get() as { satellite_id: string } | undefined;
  if (open) return open.satellite_id;
  const worst = db.prepare(
    `SELECT s.id FROM satellites s
     WHERE (s.lifecycle_state IS NULL OR s.lifecycle_state = 'ACTIVE')
       AND EXISTS (SELECT 1 FROM telemetry t WHERE t.satellite_id = s.id)
     ORDER BY s.health_score ASC LIMIT 1`,
  ).get() as { id: string } | undefined;
  if (worst) return worst.id;
  const any = db.prepare(`SELECT id FROM satellites ORDER BY id LIMIT 1`).get() as { id: string } | undefined;
  return any?.id ?? '';
}

function safeArr(s: string): string[] {
  try { return JSON.parse(s); } catch { return []; }
}

export default router;
