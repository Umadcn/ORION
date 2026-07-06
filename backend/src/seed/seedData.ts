/**
 * Seed data: 5 satellites, normal historical telemetry, one historical resolved
 * investigation, and default threshold settings. Runs only when the database is
 * empty. RESET DEMO (simulationService) reuses these baselines.
 */
import { db, now } from '../db.js';
import { ensureDefaultSettings } from '../services/settingsService.js';
import type { SatelliteStatus } from '../types.js';

export interface SatelliteSeed {
  id: string;
  name: string;
  norad_id: string;
  mission: string;
  orbit_type: string;
  altitude: number; // baseline altitude km
  velocity: number; // km/s
  latitude: number;
  longitude: number;
  // Nominal telemetry baselines for the simulator:
  base_temp: number;
  base_battery: number;
  base_signal: number;
  base_power: number;
}

export const SATELLITE_SEED: SatelliteSeed[] = [
  { id: 'ORION-1', name: 'ORION-1', norad_id: '90001', mission: 'Earth Observation', orbit_type: 'LEO', altitude: 550, velocity: 7.59, latitude: 12.9, longitude: 77.6, base_temp: 21, base_battery: 98, base_signal: -92, base_power: 610 },
  { id: 'ORION-2', name: 'ORION-2', norad_id: '90002', mission: 'Communications Relay', orbit_type: 'LEO', altitude: 560, velocity: 7.58, latitude: 35.7, longitude: 139.7, base_temp: 23, base_battery: 95, base_signal: -94, base_power: 640 },
  { id: 'ORION-3', name: 'ORION-3', norad_id: '90003', mission: 'Scientific Payload', orbit_type: 'LEO', altitude: 545, velocity: 7.6, latitude: -33.9, longitude: 151.2, base_temp: 24, base_battery: 97, base_signal: -95, base_power: 660 },
  { id: 'ORION-4', name: 'ORION-4', norad_id: '90004', mission: 'Navigation', orbit_type: 'MEO', altitude: 12000, velocity: 4.76, latitude: 51.5, longitude: -0.1, base_temp: 19, base_battery: 91, base_signal: -98, base_power: 700 },
  { id: 'ORION-5', name: 'ORION-5', norad_id: '90005', mission: 'Weather Monitoring', orbit_type: 'LEO', altitude: 600, velocity: 7.55, latitude: 40.7, longitude: -74.0, base_temp: 22, base_battery: 88, base_signal: -97, base_power: 620 },
];

export function getSeedFor(id: string): SatelliteSeed | undefined {
  return SATELLITE_SEED.find((s) => s.id === id);
}

/** Deterministic small oscillation so normal telemetry looks alive but stable. */
export function nominalTelemetry(seed: SatelliteSeed, tick: number) {
  const wobble = (amp: number, phase: number) => amp * Math.sin((tick + phase) * 0.35);
  return {
    temperature_c: round(seed.base_temp + wobble(1.5, 0)),
    battery_percent: clamp(round(seed.base_battery + wobble(0.8, 1)), 0, 100),
    signal_strength_dbm: round(seed.base_signal + wobble(1.2, 2)),
    power_consumption_w: round(seed.base_power + wobble(15, 3)),
    altitude_km: round(seed.altitude + wobble(0.4, 4)),
    velocity_kms: round(seed.velocity + wobble(0.005, 5)),
    latitude: round(seed.latitude + wobble(0.05, 6)),
    longitude: round(seed.longitude + wobble(0.05, 7)),
  };
}

export function seedIfEmpty(): void {
  ensureDefaultSettings();

  const count = (db.prepare('SELECT COUNT(*) AS c FROM satellites').get() as { c: number }).c;
  if (count > 0) return;

  const insertSat = db.prepare(
    `INSERT INTO satellites (id, name, norad_id, mission, orbit_type, altitude, velocity, latitude, longitude, health_score, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTel = db.prepare(
    `INSERT INTO telemetry (satellite_id, timestamp, temperature_c, battery_percent, signal_strength_dbm, power_consumption_w, altitude_km, velocity_kms, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const startMs = Date.now() - 30 * 60 * 1000; // 30 minutes of history

  for (const seed of SATELLITE_SEED) {
    insertSat.run(
      seed.id, seed.name, seed.norad_id, seed.mission, seed.orbit_type,
      seed.altitude, seed.velocity, seed.latitude, seed.longitude,
      healthFor(seed.base_battery), 'HEALTHY' as SatelliteStatus,
    );
    // 60 historical samples at 30s spacing.
    for (let i = 0; i < 60; i++) {
      const t = nominalTelemetry(seed, i);
      const ts = new Date(startMs + i * 30_000).toISOString();
      insertTel.run(
        seed.id, ts, t.temperature_c, t.battery_percent, t.signal_strength_dbm,
        t.power_consumption_w, t.altitude_km, t.velocity_kms, t.latitude, t.longitude,
      );
    }
  }

  seedHistoricalInvestigation();
}

/** A pre-resolved investigation so the Investigations/Reports pages are never empty. */
function seedHistoricalInvestigation(): void {
  const ts = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const resolvedTs = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

  const info = db.prepare(
    `INSERT INTO investigations
      (title, satellite_id, status, priority, detected_anomalies, root_cause, confidence, severity,
       explanation, scoring_breakdown, review_decision, created_at, updated_at, reviewed_at, resolved_at)
     VALUES (?, ?, 'RESOLVED', 'LOW', ?, 'COMMUNICATION_SUBSYSTEM_FAILURE', 0.78, 'LOW', ?, ?, 'APPROVED', ?, ?, ?, ?)`,
  ).run(
    'ORION-5 Signal Degradation',
    'ORION-5',
    JSON.stringify(['COMMUNICATION_LOSS']),
    'Historical resolved case retained for demonstration. Signal degradation on ORION-5 was traced to a ' +
      'transient communication subsystem issue that recovered after switching to the redundant transponder.',
    JSON.stringify([
      { root_cause: 'COMMUNICATION_SUBSYSTEM_FAILURE', raw_score: 0.5, normalized: 0.72, contributions: [{ factor: 'COMMUNICATION_LOSS', weight: 0.5 }] },
    ]),
    ts, resolvedTs, resolvedTs, resolvedTs,
  );
  const invId = Number(info.lastInsertRowid);

  db.prepare(
    `INSERT INTO recommendations (investigation_id, action, rationale, priority) VALUES (?, ?, ?, ?)`,
  ).run(invId, 'Switch to redundant transponder', 'Restore the downlink via a backup path', 'HIGH');

  db.prepare(
    `INSERT INTO evidence (investigation_id, source_type, source_name, summary, details, reliability_score, supports_root_cause, timestamp, source_url, mode, cached, fallback_used)
     VALUES (?, 'TELEMETRY', 'Telemetry Monitoring Agent', ?, '{}', 0.9, 1, ?, NULL, NULL, 0, 0)`,
  ).run(invId, 'Signal strength briefly dropped below -110 dBm before recovering.', ts);
}

function healthFor(battery: number): number {
  return round(Math.max(0, Math.min(100, battery)));
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
