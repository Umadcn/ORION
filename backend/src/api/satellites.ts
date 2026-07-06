/**
 * Satellites API — read + authenticated human satellite management (dynamic
 * onboarding). Create/edit/archive/reactivate are explicit HUMAN actions gated
 * by RBAC. AI systems never call these endpoints. All input is validated
 * server-side; SQL is parameterized; only whitelisted fields are writable.
 *
 * RBAC: Analyst = read only · Director = create/edit · Admin = create/edit/
 * archive/reactivate.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { requireRole, type AuthedRequest } from '../auth/middleware.js';
import { getRecentTelemetry, getLatestTelemetry } from '../services/telemetryService.js';
import { simulation } from '../services/simulationService.js';
import {
  createSatellite, updateSatellite, archiveSatellite, reactivateSatellite,
  listSatellites, getSatelliteById, isSimEligible,
  setSatelliteStatus, listSatelliteStatusHistory,
} from '../services/satelliteService.js';
import { db } from '../db.js';
import type { Alert } from '../types.js';

const router = Router();

// GET /api/satellites?includeArchived=true — list (archived excluded by default).
router.get('/', (req, res) => {
  const includeArchived = String((req.query as Record<string, string>).includeArchived ?? '') === 'true';
  res.json(listSatellites({ includeArchived }));
});

// POST /api/satellites — register a new satellite (Director/Admin).
router.post(
  '/',
  requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'),
  asyncHandler((req: AuthedRequest, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const sat = createSatellite(
      {
        id: b.id as string, name: b.name as string, mission: b.mission as string,
        description: b.description as string, orbit_type: b.orbit_type as string,
        norad_catalog_id: b.norad_catalog_id as string, tle_line1: b.tle_line1 as string, tle_line2: b.tle_line2 as string,
        altitude: b.altitude as number, velocity: b.velocity as number, inclination: b.inclination as number,
        orbital_period_min: b.orbital_period_min as number, latitude: b.latitude as number, longitude: b.longitude as number,
        launch_date: b.launch_date as string, sim_eligible: b.sim_eligible as boolean,
      },
      req.user!.sub,
    );
    res.status(201).json(sat);
  }),
);

// GET /api/satellites/:id — satellite + honest orbit/telemetry states + relations.
router.get(
  '/:id',
  asyncHandler((req, res) => {
    const sat = getSatelliteById(req.params.id);
    if (!sat) return res.status(404).json({ error: 'NOT_FOUND', message: 'Satellite not found' });
    const alerts = db.prepare(`SELECT * FROM alerts WHERE satellite_id = ? AND status != 'RESOLVED' ORDER BY id DESC`).all(sat.id) as Alert[];
    const investigations = db.prepare(`SELECT * FROM investigations WHERE satellite_id = ? ORDER BY id DESC`).all(sat.id);
    const latest = getLatestTelemetry(sat.id);
    const telemetryState = latest ? (sat.data_source_mode ?? 'SIMULATED') : 'NO_TELEMETRY';
    return res.json({
      ...sat,
      orbit_data_state: sat.orbit_data_state ?? 'UNAVAILABLE',
      telemetry_state: telemetryState,
      has_telemetry: !!latest,
      simulated: simulation.activeTargets().includes(sat.id),
      sim_eligible: (sat.sim_eligible ?? 1) === 1,
      active_alerts: alerts,
      investigations,
    });
  }),
);

// GET /api/satellites/:id/telemetry — recent telemetry (honest empty when none).
router.get(
  '/:id/telemetry',
  asyncHandler((req, res) => {
    const sat = getSatelliteById(req.params.id);
    if (!sat) return res.status(404).json({ error: 'NOT_FOUND', message: 'Satellite not found' });
    const limit = Math.min(Number(req.query.limit ?? 60), 500);
    return res.json(getRecentTelemetry(sat.id, limit));
  }),
);

// PATCH /api/satellites/:id — edit metadata (Director/Admin).
router.patch(
  '/:id',
  requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'),
  asyncHandler((req, res) => {
    const sat = updateSatellite(req.params.id, (req.body ?? {}) as Record<string, unknown>);
    res.json(sat);
  }),
);

// PATCH /api/satellites/:id/status — manual status control (Director/Admin).
// Body: { mode: 'AUTO' | 'MANUAL', status?: 'HEALTHY'|'WARNING'|'ALERT', reason?: string }.
// Display/operational override only — never fabricates telemetry/alerts/investigations/RCA.
router.patch(
  '/:id/status',
  requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'),
  asyncHandler((req: AuthedRequest, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const result = setSatelliteStatus(
      req.params.id,
      { mode: b.mode as never, status: b.status as never, reason: b.reason as string | undefined },
      { id: req.user!.sub, role: req.user!.role },
    );
    res.json(result);
  }),
);

// GET /api/satellites/:id/status/history — bounded manual-status audit trail (any authenticated role).
router.get(
  '/:id/status/history',
  asyncHandler((req, res) => {
    const sat = getSatelliteById(req.params.id);
    if (!sat) return res.status(404).json({ error: 'NOT_FOUND', message: 'Satellite not found' });
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    return res.json(listSatelliteStatusHistory(sat.id, limit));
  }),
);

// POST /api/satellites/:id/archive — decommission (Admin only). No hard delete.
router.post(
  '/:id/archive',
  requireRole('SYSTEM_ADMIN'),
  asyncHandler((req, res) => {
    const sat = archiveSatellite(req.params.id);
    simulation.stopForSatellite(sat.id); // stop simulating an archived satellite
    res.json(sat);
  }),
);

// POST /api/satellites/:id/reactivate — reactivate (Admin only).
router.post(
  '/:id/reactivate',
  requireRole('SYSTEM_ADMIN'),
  asyncHandler((req, res) => {
    res.json(reactivateSatellite(req.params.id));
  }),
);

// POST /api/satellites/:id/simulate — explicitly start simulation (Director/Admin).
router.post(
  '/:id/simulate',
  requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'),
  asyncHandler((req, res) => {
    const sat = getSatelliteById(req.params.id);
    if (!sat) return res.status(404).json({ error: 'NOT_FOUND', message: 'Satellite not found' });
    if (!isSimEligible(sat)) return res.status(409).json({ error: 'NOT_ELIGIBLE', message: 'Satellite is archived or not simulation-eligible' });
    const result = simulation.startForSatellite(sat.id);
    return res.status(result.ok ? 200 : 409).json({ ...result, status: simulation.status() });
  }),
);

// POST /api/satellites/:id/simulate/stop — stop simulating this satellite (Director/Admin).
router.post(
  '/:id/simulate/stop',
  requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'),
  asyncHandler((req, res) => {
    const result = simulation.stopForSatellite(req.params.id);
    res.json({ ...result, status: simulation.status() });
  }),
);

export default router;
