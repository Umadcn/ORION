// Centralized effective-status → visual mapping for the 3D globe. The globe
// ALWAYS renders effectiveStatus (never derivedStatus) — a satellite serialized
// by the backend already carries `status` = effective, with explicit
// `effective_status` as a fallback.
import type { Satellite, SatelliteStatus } from '../../types';

/** The authoritative status to render — effective, never derived. */
export function effectiveStatusOf(sat: Pick<Satellite, 'status' | 'effective_status'>): SatelliteStatus {
  return sat.effective_status ?? sat.status;
}

/** Hex marker color for a status. UNKNOWN/OFFLINE render as a neutral slate. */
export function statusColorHex(status: SatelliteStatus | string | null | undefined): string {
  switch (status) {
    case 'HEALTHY': return '#22c55e';
    case 'WARNING': return '#f59e0b';
    case 'ALERT':   return '#ef4444';
    case 'OFFLINE': return '#64748b';
    default:        return '#94a3b8'; // UNKNOWN / unset
  }
}

export interface StatusLegendEntry { status: SatelliteStatus; label: string; color: string }
export const STATUS_LEGEND: StatusLegendEntry[] = [
  { status: 'HEALTHY', label: 'Healthy', color: statusColorHex('HEALTHY') },
  { status: 'WARNING', label: 'Warning', color: statusColorHex('WARNING') },
  { status: 'ALERT', label: 'Alert', color: statusColorHex('ALERT') },
];

/** Status filter values (ALL + the three canonical effective statuses). */
export type StatusFilter = 'ALL' | 'HEALTHY' | 'WARNING' | 'ALERT';
export const STATUS_FILTERS: StatusFilter[] = ['ALL', 'HEALTHY', 'WARNING', 'ALERT'];

/** True when a satellite passes the effective-status filter. */
export function passesStatusFilter(sat: Pick<Satellite, 'status' | 'effective_status'>, filter: StatusFilter): boolean {
  if (filter === 'ALL') return true;
  return effectiveStatusOf(sat) === filter;
}
