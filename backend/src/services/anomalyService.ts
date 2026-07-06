/**
 * Alert creation with deduplication / cooldown.
 * An alert of the same (satellite, anomaly_type) is not recreated while an ACTIVE
 * alert exists, and not within a cooldown window — preventing "alert storms"
 * every polling cycle.
 */
import { db, now } from '../db.js';
import type { Alert, AnomalyType, DetectedAnomaly, Severity } from '../types.js';

const COOLDOWN_MS = 60_000; // one alert per anomaly type per minute per satellite

export interface CreatedAlert {
  alert: Alert;
  isNew: boolean;
}

export function createAlertIfNeeded(
  satelliteId: string,
  anomaly: DetectedAnomaly,
): CreatedAlert | null {
  // Existing ACTIVE alert of the same type → suppress duplicate.
  const active = db
    .prepare(
      `SELECT * FROM alerts WHERE satellite_id = ? AND anomaly_type = ? AND status = 'ACTIVE'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(satelliteId, anomaly.type) as Alert | undefined;
  if (active) return { alert: active, isNew: false };

  // Cooldown: skip if a same-type alert was created very recently.
  const recent = db
    .prepare(
      `SELECT created_at FROM alerts WHERE satellite_id = ? AND anomaly_type = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(satelliteId, anomaly.type) as { created_at: string } | undefined;
  if (recent) {
    const age = Date.now() - new Date(recent.created_at).getTime();
    if (age < COOLDOWN_MS) return null;
  }

  const message = anomaly.description;
  const info = db
    .prepare(
      `INSERT INTO alerts (satellite_id, anomaly_type, severity, message, status, created_at)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
    )
    .run(satelliteId, anomaly.type, anomaly.severity, message, now());
  const alert = db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(Number(info.lastInsertRowid)) as Alert;
  return { alert, isNew: true };
}

export function linkAlertsToInvestigation(satelliteId: string, investigationId: number): void {
  db.prepare(
    `UPDATE alerts SET investigation_id = ?
     WHERE satellite_id = ? AND status = 'ACTIVE' AND investigation_id IS NULL`,
  ).run(investigationId, satelliteId);
}

export function getActiveAlertTypes(satelliteId: string): AnomalyType[] {
  const rows = db
    .prepare(`SELECT DISTINCT anomaly_type FROM alerts WHERE satellite_id = ? AND status = 'ACTIVE'`)
    .all(satelliteId) as { anomaly_type: AnomalyType }[];
  return rows.map((r) => r.anomaly_type);
}

export function acknowledgeAlert(id: number): Alert | undefined {
  db.prepare(`UPDATE alerts SET status = 'ACKNOWLEDGED' WHERE id = ? AND status = 'ACTIVE'`).run(id);
  return db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(id) as Alert | undefined;
}

export function priorityFromSeverity(sev: Severity): Severity {
  return sev;
}
