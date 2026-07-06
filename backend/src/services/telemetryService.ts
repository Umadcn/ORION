/**
 * Telemetry persistence and query helpers.
 */
import { db } from '../db.js';
import type { Satellite, Telemetry } from '../types.js';

export function insertTelemetry(t: Omit<Telemetry, 'id'>): void {
  db.prepare(
    `INSERT INTO telemetry
      (satellite_id, timestamp, temperature_c, battery_percent, signal_strength_dbm, power_consumption_w, altitude_km, velocity_kms, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.satellite_id, t.timestamp, t.temperature_c, t.battery_percent, t.signal_strength_dbm,
    t.power_consumption_w, t.altitude_km, t.velocity_kms, t.latitude, t.longitude,
  );
}

/** Most recent N samples for a satellite, returned oldest → newest. */
export function getRecentTelemetry(satelliteId: string, limit = 30): Telemetry[] {
  const rows = db
    .prepare(
      `SELECT * FROM telemetry WHERE satellite_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(satelliteId, limit) as Telemetry[];
  return rows.reverse();
}

export function getLatestTelemetry(satelliteId: string): Telemetry | undefined {
  return db
    .prepare(`SELECT * FROM telemetry WHERE satellite_id = ? ORDER BY id DESC LIMIT 1`)
    .get(satelliteId) as Telemetry | undefined;
}

export function getLatestForAll(): Telemetry[] {
  return db
    .prepare(
      `SELECT t.* FROM telemetry t
       JOIN (SELECT satellite_id, MAX(id) AS mid FROM telemetry GROUP BY satellite_id) m
         ON t.id = m.mid
       ORDER BY t.satellite_id`,
    )
    .all() as Telemetry[];
}

export function getSatellite(id: string): Satellite | undefined {
  return db.prepare(`SELECT * FROM satellites WHERE id = ?`).get(id) as Satellite | undefined;
}

export function getAllSatellites(): Satellite[] {
  return db.prepare(`SELECT * FROM satellites ORDER BY id`).all() as Satellite[];
}

export function updateSatelliteHealth(id: string, health: number, status: string): void {
  db.prepare(`UPDATE satellites SET health_score = ?, status = ? WHERE id = ?`).run(
    Math.round(health * 100) / 100,
    status,
    id,
  );
}
