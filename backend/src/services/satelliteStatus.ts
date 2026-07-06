/**
 * Canonical satellite-status resolver — the single source of truth for
 * `effectiveStatus`. Reused by every read surface so status is computed in one
 * place, never re-derived per module.
 *
 *   derivedStatus   = the system-computed status persisted in `satellites.status`
 *                     (written only by the simulation/anomaly pipeline).
 *   effectiveStatus = MANUAL override when set, otherwise derivedStatus.
 *
 * A manual override is a persistent display/operational status chosen by an
 * authorized operator. It NEVER overwrites derivedStatus and NEVER fabricates
 * telemetry, alerts, investigations, RCA, or evidence.
 */
import type {
  ManualSatelliteStatus,
  Satellite,
  SatelliteStatus,
  SatelliteStatusMode,
} from '../types.js';

/** Operator-selectable manual statuses (subset of SatelliteStatus). */
export const MANUAL_STATUS_VALUES: readonly ManualSatelliteStatus[] = ['HEALTHY', 'WARNING', 'ALERT'];
export const STATUS_MODE_VALUES: readonly SatelliteStatusMode[] = ['AUTO', 'MANUAL'];
export const MAX_STATUS_REASON_LEN = 500;

export function isManualStatus(v: unknown): v is ManualSatelliteStatus {
  return typeof v === 'string' && (MANUAL_STATUS_VALUES as readonly string[]).includes(v);
}
export function isStatusMode(v: unknown): v is SatelliteStatusMode {
  return typeof v === 'string' && (STATUS_MODE_VALUES as readonly string[]).includes(v);
}

export interface ResolvedSatelliteStatus {
  statusMode: SatelliteStatusMode;
  manualStatus: ManualSatelliteStatus | null;
  derivedStatus: SatelliteStatus;
  effectiveStatus: SatelliteStatus;
  manualStatusReason: string | null;
  manualStatusUpdatedAt: string | null;
  manualStatusUpdatedBy: string | null;
}

/**
 * Resolve the effective status for a raw satellite row. Defensive: a row whose
 * mode is MANUAL but whose manual_status is missing/invalid falls back to AUTO
 * (never invents a status).
 */
export function resolveSatelliteStatus(row: Satellite): ResolvedSatelliteStatus {
  const derivedStatus = (row.status ?? 'UNKNOWN') as SatelliteStatus;
  const manualStatus = isManualStatus(row.manual_status) ? row.manual_status : null;
  const statusMode: SatelliteStatusMode = row.status_mode === 'MANUAL' && manualStatus ? 'MANUAL' : 'AUTO';
  const effectiveStatus = statusMode === 'MANUAL' ? (manualStatus as SatelliteStatus) : derivedStatus;
  return {
    statusMode,
    manualStatus,
    derivedStatus,
    effectiveStatus,
    manualStatusReason: statusMode === 'MANUAL' ? (row.manual_status_reason ?? null) : (row.manual_status_reason ?? null),
    manualStatusUpdatedAt: row.manual_status_updated_at ?? null,
    manualStatusUpdatedBy: row.manual_status_updated_by ?? null,
  };
}

/**
 * Serialize a raw satellite row for API/UI/AI consumption: the `status` field is
 * set to the EFFECTIVE status (so all existing consumers reflect the override),
 * with `derived_status` / `effective_status` / mode fields exposed explicitly.
 */
export function serializeSatellite(row: Satellite): Satellite {
  const r = resolveSatelliteStatus(row);
  return {
    ...row,
    status: r.effectiveStatus,
    status_mode: r.statusMode,
    manual_status: r.manualStatus,
    manual_status_reason: r.manualStatusReason,
    derived_status: r.derivedStatus,
    effective_status: r.effectiveStatus,
  };
}
