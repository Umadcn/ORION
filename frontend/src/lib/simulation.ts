// Pure helpers for the Satellite Simulation Control Center. No React, no I/O —
// unit-tested in isolation. The failure catalog itself is loaded dynamically
// from the backend; only presentational field metadata lives here.
import type { Role, SimFailure, SimFieldKey, SimSatellite, SimSession, SimSessionStatus } from '../types';

export const SIM_SPEEDS = [0.5, 1, 2, 5, 10];

export interface SimFieldMeta {
  key: SimFieldKey;
  label: string;
  unit: string;
}

export const SIM_FIELDS: SimFieldMeta[] = [
  { key: 'battery_percent', label: 'Battery', unit: '%' },
  { key: 'temperature_c', label: 'Temperature', unit: '°C' },
  { key: 'power_consumption_w', label: 'Power', unit: 'W' },
  { key: 'signal_strength_dbm', label: 'Signal', unit: 'dBm' },
  { key: 'altitude_km', label: 'Altitude', unit: 'km' },
];

/** Only Mission Director / System Admin may mutate simulations (matches backend RBAC). */
export function canControlSimulation(role: Role | null | undefined): boolean {
  return role === 'MISSION_DIRECTOR' || role === 'SYSTEM_ADMIN';
}

export function sessionStatusColor(status: SimSessionStatus | null | undefined): string {
  switch (status) {
    case 'RUNNING': return 'text-accent-green';
    case 'PAUSED': return 'text-accent-orange';
    case 'INTERRUPTED': return 'text-accent-orange';
    case 'STOPPED': return 'text-slate-400';
    case 'FAILED': return 'text-accent-red';
    case 'CREATED': return 'text-accent-blue';
    default: return 'text-slate-500';
  }
}

export function canStart(status: SimSessionStatus | null | undefined): boolean {
  return status === 'CREATED' || status === 'STOPPED' || status === 'INTERRUPTED';
}
export function canPause(status: SimSessionStatus | null | undefined): boolean {
  return status === 'RUNNING';
}
export function canResume(status: SimSessionStatus | null | undefined): boolean {
  return status === 'PAUSED' || status === 'INTERRUPTED';
}
export function canStop(status: SimSessionStatus | null | undefined): boolean {
  return status === 'RUNNING' || status === 'PAUSED';
}
export function canInject(status: SimSessionStatus | null | undefined): boolean {
  return status === 'RUNNING' || status === 'PAUSED' || status === 'CREATED';
}

/** Active (still-applying) failures for a session. */
export function activeFailures(session: SimSession | null | undefined): SimFailure[] {
  if (!session) return [];
  return session.failures.filter((f) => f.state === 'ACTIVE');
}

/** Dynamic satellite-selector filter: id / name / mission / status (case-insensitive). */
export function filterSatellites(sats: SimSatellite[], query: string): SimSatellite[] {
  const q = query.trim().toLowerCase();
  if (!q) return sats;
  return sats.filter((s) =>
    s.id.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q) ||
    s.mission.toLowerCase().includes(q) ||
    String(s.status).toLowerCase().includes(q),
  );
}

export function fieldLabel(key: SimFieldKey): string {
  return SIM_FIELDS.find((f) => f.key === key)?.label ?? key;
}
export function fieldUnit(key: SimFieldKey): string {
  return SIM_FIELDS.find((f) => f.key === key)?.unit ?? '';
}

export function formatFieldValue(key: SimFieldKey, value: number): string {
  const unit = fieldUnit(key);
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${unit ? ` ${unit}` : ''}`;
}

/** True when a satellite already has a non-terminal session. */
export function hasLiveSession(sat: SimSatellite | null | undefined): boolean {
  return !!sat && sat.session_status != null && sat.session_status !== 'STOPPED' && sat.session_status !== 'FAILED';
}
