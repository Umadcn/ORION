/**
 * Satellite Simulation Control Center API.
 *
 * A general-purpose, human-controlled simulation surface: dynamic satellite
 * selection, a dynamic failure catalog, and per-session lifecycle / speed /
 * telemetry-config / failure-management. There is NO demo launcher, NO scenario
 * map, NO destructive reset. Simulation only emits telemetry; the EXISTING
 * deterministic anomaly engine decides anomalies/alerts/investigations.
 *
 * RBAC: any authenticated role may VIEW; only MISSION_DIRECTOR / SYSTEM_ADMIN may
 * MUTATE (create/start/pause/resume/stop/config/speed/failures). Enforced here,
 * server-side, independent of the UI.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { simulation } from '../services/simulationService.js';
import { requireRole } from '../auth/middleware.js';
import type { AuthedRequest } from '../auth/middleware.js';

const router = Router();

// Mutations are Director/Admin decisions.
const mutate = requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN');
const actorOf = (req: AuthedRequest) => req.user?.username ?? req.user?.sub ?? 'system';

// ---------- Read (any authenticated role) ----------

router.get('/status', (_req, res) => res.json(simulation.status()));

router.get('/satellites', (_req, res) => res.json(simulation.listSimEligibleSatellites()));

router.get('/failures', (_req, res) => res.json(simulation.failureCatalog()));

router.get('/sessions', (_req, res) => {
  res.json(simulation.listSessions().map((s) => simulation.serializeSession(s.id)));
});

router.get('/sessions/:id', asyncHandler((req, res) => {
  res.json(simulation.serializeSession(req.params.id));
}));

router.get('/sessions/:id/status', asyncHandler((req, res) => {
  res.json(simulation.serializeSession(req.params.id));
}));

router.get('/sessions/:id/failures', asyncHandler((req, res) => {
  const row = simulation.serializeSession(req.params.id);
  res.json(row.failures);
}));

router.get('/sessions/:id/telemetry', asyncHandler((req, res) => {
  const limit = Number(req.query.limit ?? 60);
  res.json(simulation.getSessionTelemetry(req.params.id, limit));
}));

router.get('/sessions/:id/events', asyncHandler((req, res) => {
  const limit = Number(req.query.limit ?? 100);
  res.json(simulation.getSessionEvents(req.params.id, limit));
}));

// ---------- Mutations (Director / Admin) ----------

router.post('/sessions', mutate, asyncHandler((req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const satelliteId = String(body.satelliteId ?? body.satellite_id ?? '').trim();
  const session = simulation.createSession(satelliteId, {
    telemetryProfile: body.telemetryProfile ?? body.telemetry_profile,
    simulationSpeed: body.simulationSpeed ?? body.simulation_speed,
  }, actorOf(req));
  res.status(201).json(simulation.serializeSession(session.id));
}));

router.post('/sessions/:id/start', mutate, asyncHandler((req: AuthedRequest, res) => {
  simulation.startSession(req.params.id, actorOf(req));
  res.json(simulation.serializeSession(req.params.id));
}));

router.post('/sessions/:id/pause', mutate, asyncHandler((req: AuthedRequest, res) => {
  simulation.pauseSession(req.params.id, actorOf(req));
  res.json(simulation.serializeSession(req.params.id));
}));

router.post('/sessions/:id/resume', mutate, asyncHandler((req: AuthedRequest, res) => {
  simulation.resumeSession(req.params.id, actorOf(req));
  res.json(simulation.serializeSession(req.params.id));
}));

router.post('/sessions/:id/stop', mutate, asyncHandler((req: AuthedRequest, res) => {
  simulation.stopSession(req.params.id, actorOf(req));
  res.json(simulation.serializeSession(req.params.id));
}));

router.patch('/sessions/:id/config', mutate, asyncHandler((req: AuthedRequest, res) => {
  const body = req.body ?? {};
  simulation.updateConfig(req.params.id, body.telemetryProfile ?? body.telemetry_profile ?? body, actorOf(req));
  res.json(simulation.serializeSession(req.params.id));
}));

router.patch('/sessions/:id/speed', mutate, asyncHandler((req: AuthedRequest, res) => {
  const body = req.body ?? {};
  simulation.setSpeed(req.params.id, Number(body.simulationSpeed ?? body.simulation_speed), actorOf(req));
  res.json(simulation.serializeSession(req.params.id));
}));

router.post('/sessions/:id/failures', mutate, asyncHandler((req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const failure = simulation.injectFailureToSession(req.params.id, {
    failureType: String(body.failureType ?? body.failure_type ?? ''),
    severity: body.severity,
    onset: body.onset,
    recovery: body.recovery,
    durationTicks: body.durationTicks ?? body.duration_ticks ?? null,
    onsetTicks: body.onsetTicks ?? body.onset_ticks,
  }, actorOf(req));
  res.status(201).json(simulation.serializeSession(req.params.id));
  void failure;
}));

router.delete('/sessions/:id/failures/:failureId', mutate, asyncHandler((req: AuthedRequest, res) => {
  simulation.removeFailure(req.params.id, req.params.failureId, actorOf(req));
  res.json(simulation.serializeSession(req.params.id));
}));

router.delete('/sessions/:id/failures', mutate, asyncHandler((req: AuthedRequest, res) => {
  const cleared = simulation.clearFailures(req.params.id, actorOf(req));
  res.json({ cleared, session: simulation.serializeSession(req.params.id) });
}));

export default router;
