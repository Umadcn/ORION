// Pure helpers for manual satellite status control. No React / no I/O so they
// can be unit-tested. Mirrors the backend canonical model: `status` on a
// serialized satellite is the EFFECTIVE status; `derived_status` is the
// system-computed one; MANUAL mode means an operator override is in effect.
import type { ManualSatelliteStatus, Role, Satellite, SatelliteStatus, SatelliteStatusMode } from '../types';

export const MANUAL_STATUS_OPTIONS: ManualSatelliteStatus[] = ['HEALTHY', 'WARNING', 'ALERT'];

/** Only Director/Admin may change manual status (mirrors backend RBAC). */
export function canManageStatus(role: Role | null | undefined): boolean {
  return role === 'MISSION_DIRECTOR' || role === 'SYSTEM_ADMIN';
}

export function statusModeOf(sat: Pick<Satellite, 'status_mode'>): SatelliteStatusMode {
  return sat.status_mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
}

export function isManualOverride(sat: Pick<Satellite, 'status_mode'>): boolean {
  return statusModeOf(sat) === 'MANUAL';
}

export function effectiveStatus(sat: Pick<Satellite, 'status' | 'effective_status'>): SatelliteStatus {
  return sat.effective_status ?? sat.status;
}

export function derivedStatus(sat: Pick<Satellite, 'status' | 'derived_status' | 'effective_status'>): SatelliteStatus {
  return sat.derived_status ?? sat.status;
}

export interface StatusFormState {
  mode: SatelliteStatusMode;
  status: ManualSatelliteStatus | '';
  reason: string;
}

export const MAX_REASON_LEN = 500;

/** Validate the form; returns a field->message map (empty = valid). */
export function validateStatusForm(f: StatusFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (f.mode === 'MANUAL' && !MANUAL_STATUS_OPTIONS.includes(f.status as ManualSatelliteStatus)) {
    errors.status = 'Select a status (HEALTHY, WARNING, or ALERT).';
  }
  if (f.reason.length > MAX_REASON_LEN) errors.reason = `Reason must be ≤ ${MAX_REASON_LEN} characters.`;
  return errors;
}

/** True when the form would actually change the satellite's current control state. */
export function isStatusChange(sat: Pick<Satellite, 'status_mode' | 'manual_status'>, f: StatusFormState): boolean {
  const curMode = statusModeOf(sat);
  if (f.mode !== curMode) return true;
  if (f.mode === 'MANUAL') return f.status !== (sat.manual_status ?? '');
  return false;
}

/** Human confirmation prompt for the pending change. */
export function describeStatusChange(id: string, currentEffective: SatelliteStatus, f: StatusFormState): string {
  if (f.mode === 'AUTO') return `Return ${id} to automatic status calculation?`;
  return `Change ${id} effective status from ${currentEffective} to ${f.status}?`;
}

/** Request body for the PATCH endpoint (omits status/reason when empty). */
export function toStatusRequest(f: StatusFormState): { mode: SatelliteStatusMode; status?: ManualSatelliteStatus; reason?: string } {
  const body: { mode: SatelliteStatusMode; status?: ManualSatelliteStatus; reason?: string } = { mode: f.mode };
  if (f.mode === 'MANUAL' && f.status) body.status = f.status;
  const reason = f.reason.trim();
  if (reason) body.reason = reason;
  return body;
}
