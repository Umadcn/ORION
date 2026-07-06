/**
 * Pure presentation helpers for dynamic satellites. Guarantee honest states in
 * the UI: a satellite with no telemetry never shows a fabricated health %, and
 * a satellite with no orbit data never shows a fabricated altitude/position.
 * Kept pure + dependency-free for unit testing without a DOM.
 */
import type { Satellite } from '../types';

export function satelliteHasTelemetry(s: Pick<Satellite, 'status' | 'data_source_mode'>): boolean {
  return s.status !== 'UNKNOWN' && (s.data_source_mode ?? 'SIMULATED') !== 'NO_TELEMETRY';
}

export function healthLabel(s: Pick<Satellite, 'status' | 'data_source_mode' | 'health_score'>): string {
  return satelliteHasTelemetry(s) ? `${Math.round(s.health_score)}%` : 'no telemetry';
}

export function orbitAvailable(s: Pick<Satellite, 'orbit_data_state' | 'altitude'>): boolean {
  return (s.orbit_data_state ?? 'MANUALLY_PROVIDED') !== 'UNAVAILABLE' && s.altitude > 0;
}

export function altitudeLabel(s: Pick<Satellite, 'orbit_data_state' | 'altitude'>): string {
  return orbitAvailable(s) ? `${Math.round(s.altitude)} km` : 'orbit data unavailable';
}

export function isSimulatable(s: Pick<Satellite, 'lifecycle_state' | 'sim_eligible'>): boolean {
  return (s.lifecycle_state ?? 'ACTIVE') === 'ACTIVE' && (s.sim_eligible ?? 1) === 1;
}

export function isArchived(s: Pick<Satellite, 'lifecycle_state'>): boolean {
  return (s.lifecycle_state ?? 'ACTIVE') === 'ARCHIVED';
}

export function isManual(s: Pick<Satellite, 'origin'>): boolean {
  return s.origin === 'MANUAL';
}
