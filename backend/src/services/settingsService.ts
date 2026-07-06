/**
 * System settings service. Stores the configurable anomaly thresholds in the
 * database as a single JSON row, with get / update / reset operations.
 */
import { db, now } from '../db.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../analysis/anomalyRules.js';

const THRESHOLDS_KEY = 'anomaly_thresholds';

export function ensureDefaultSettings(): void {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(THRESHOLDS_KEY);
  if (!row) {
    db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)').run(
      THRESHOLDS_KEY,
      JSON.stringify(DEFAULT_THRESHOLDS),
      now(),
    );
  }
}

export function getThresholds(): Thresholds {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(THRESHOLDS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_THRESHOLDS };
  try {
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function updateThresholds(partial: Partial<Thresholds>): Thresholds {
  const current = getThresholds();
  const merged: Thresholds = { ...current, ...partial };
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(THRESHOLDS_KEY, JSON.stringify(merged), now());
  return merged;
}

export function resetThresholds(): Thresholds {
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(THRESHOLDS_KEY, JSON.stringify(DEFAULT_THRESHOLDS), now());
  return { ...DEFAULT_THRESHOLDS };
}
