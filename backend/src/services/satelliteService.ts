/**
 * Satellite management service (dynamic onboarding).
 *
 * The canonical create/update/archive/reactivate path for satellites. A
 * manually-registered satellite is a first-class persisted entity that flows
 * through every module. It is created with NO fabricated data: no telemetry, no
 * alerts, no investigations, and honest orbit-data / data-source states. Those
 * capabilities appear only as the satellite receives real or explicitly
 * simulated telemetry and progresses through the existing pipeline.
 *
 * All input is validated + normalized server-side (enum/length/numeric bounds),
 * SQL is parameterized, and only an explicit whitelist of fields is writable
 * (mass-assignment safe). AI systems never call this service.
 */
import { db, now, transaction } from '../db.js';
import { getSatellite as getSatelliteRow, getAllSatellites } from './telemetryService.js';
import {
  serializeSatellite, resolveSatelliteStatus, isManualStatus, isStatusMode,
  MANUAL_STATUS_VALUES, STATUS_MODE_VALUES, MAX_STATUS_REASON_LEN,
} from './satelliteStatus.js';
import type {
  DataSourceMode, ManualSatelliteStatus, OrbitDataState, Satellite,
  SatelliteStatusEvent, SatelliteStatusMode,
} from '../types.js';

export class SatelliteValidationError extends Error {
  constructor(message: string, public details?: Record<string, string>) { super(message); }
}
export class SatelliteConflictError extends Error {}
export class SatelliteNotFoundError extends Error {}

const ORBIT_TYPES = new Set(['LEO', 'MEO', 'GEO', 'HEO', 'SSO', 'POLAR', 'OTHER', 'UNKNOWN']);
const ID_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export interface SatelliteCreateInput {
  id: string;
  name?: string;
  mission: string;
  description?: string | null;
  orbit_type?: string | null;
  norad_catalog_id?: string | null;
  tle_line1?: string | null;
  tle_line2?: string | null;
  altitude?: number | null;
  velocity?: number | null;
  inclination?: number | null;
  orbital_period_min?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  launch_date?: string | null;
  sim_eligible?: boolean;
}

export type SatelliteUpdateInput = Partial<Omit<SatelliteCreateInput, 'id'>>;

function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function optNum(v: unknown, field: string, lo: number, hi: number, errors: Record<string, string>): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) { errors[field] = `${field} must be a finite number`; return null; }
  if (n < lo || n > hi) { errors[field] = `${field} must be between ${lo} and ${hi}`; return null; }
  return Math.round(n * 1e6) / 1e6;
}

/** Honest orbit-data state: TLE or orbital params → MANUALLY_PROVIDED, else UNAVAILABLE. */
function deriveOrbitState(i: { tle_line1?: string | null; tle_line2?: string | null; altitude?: number | null }): OrbitDataState {
  if (i.tle_line1 && i.tle_line2) return 'MANUALLY_PROVIDED';
  if (typeof i.altitude === 'number' && i.altitude > 0) return 'MANUALLY_PROVIDED';
  return 'UNAVAILABLE';
}

function normalizeCreate(input: SatelliteCreateInput): { row: Record<string, unknown>; orbitState: OrbitDataState } {
  const errors: Record<string, string> = {};
  const id = str(input.id).toUpperCase();
  if (!id) errors.id = 'satellite id is required';
  else if (!ID_RE.test(id)) errors.id = 'id must be 2–32 chars: letters, digits, hyphen, underscore (e.g. SAT-NEW-001)';

  const mission = str(input.mission);
  if (!mission) errors.mission = 'mission is required';
  else if (mission.length > 120) errors.mission = 'mission must be ≤ 120 chars';

  const name = (str(input.name) || id).slice(0, 120);
  const description = input.description != null ? str(input.description).slice(0, 2000) : null;
  const orbitTypeRaw = str(input.orbit_type).toUpperCase();
  const orbit_type = orbitTypeRaw ? (ORBIT_TYPES.has(orbitTypeRaw) ? orbitTypeRaw : (errors.orbit_type = `orbit_type must be one of ${[...ORBIT_TYPES].join(', ')}`, orbitTypeRaw)) : 'UNKNOWN';
  const norad = input.norad_catalog_id != null ? str(input.norad_catalog_id) : '';
  if (norad && !/^\d{1,9}$/.test(norad)) errors.norad_catalog_id = 'norad_catalog_id must be numeric (1–9 digits)';
  const tle1 = input.tle_line1 != null ? str(input.tle_line1).slice(0, 80) : null;
  const tle2 = input.tle_line2 != null ? str(input.tle_line2).slice(0, 80) : null;
  if ((tle1 && !tle2) || (!tle1 && tle2)) errors.tle = 'both tle_line1 and tle_line2 are required together';

  const altitude = optNum(input.altitude, 'altitude', 0, 500000, errors);
  const velocity = optNum(input.velocity, 'velocity', 0, 20, errors);
  const inclination = optNum(input.inclination, 'inclination', 0, 180, errors);
  const orbital_period_min = optNum(input.orbital_period_min, 'orbital_period_min', 0, 100000, errors);
  const latitude = optNum(input.latitude, 'latitude', -90, 90, errors);
  const longitude = optNum(input.longitude, 'longitude', -180, 180, errors);
  const launch_date = input.launch_date != null && str(input.launch_date) ? str(input.launch_date).slice(0, 40) : null;

  if (Object.keys(errors).length) throw new SatelliteValidationError('Invalid satellite input', errors);

  const orbitState = deriveOrbitState({ tle_line1: tle1, tle_line2: tle2, altitude });
  const ts = now();
  return {
    orbitState,
    row: {
      id, name, norad_id: norad, mission, orbit_type,
      altitude: altitude ?? 0, velocity: velocity ?? 0, latitude: latitude ?? 0, longitude: longitude ?? 0,
      health_score: 0, status: 'UNKNOWN',
      display_name: name, description, norad_catalog_id: norad || null,
      tle_line1: tle1, tle_line2: tle2, inclination, orbital_period_min, launch_date,
      orbit_data_state: orbitState, data_source_mode: 'NO_TELEMETRY' as DataSourceMode,
      sim_eligible: input.sim_eligible === false ? 0 : 1, lifecycle_state: 'ACTIVE', origin: 'MANUAL',
      created_at: ts, updated_at: ts, archived_at: null,
    },
  };
}

export function createSatellite(input: SatelliteCreateInput, createdBy: string): Satellite {
  const { row } = normalizeCreate(input);
  return transaction(() => {
    // Unique satellite id (case-insensitive via the uppercase normalization).
    if (getSatelliteRow(String(row.id))) throw new SatelliteConflictError(`Satellite ${row.id} already exists`);
    if (row.norad_catalog_id) {
      const dup = db.prepare('SELECT id FROM satellites WHERE norad_catalog_id = ?').get(row.norad_catalog_id) as { id: string } | undefined;
      if (dup) throw new SatelliteConflictError(`NORAD catalog id ${row.norad_catalog_id} already registered to ${dup.id}`);
    }
    db.prepare(
      `INSERT INTO satellites
        (id, name, norad_id, mission, orbit_type, altitude, velocity, latitude, longitude, health_score, status,
         display_name, description, norad_catalog_id, tle_line1, tle_line2, inclination, orbital_period_min,
         launch_date, orbit_data_state, data_source_mode, sim_eligible, lifecycle_state, origin, created_by,
         created_at, updated_at, archived_at)
       VALUES (@id,@name,@norad_id,@mission,@orbit_type,@altitude,@velocity,@latitude,@longitude,@health_score,@status,
         @display_name,@description,@norad_catalog_id,@tle_line1,@tle_line2,@inclination,@orbital_period_min,
         @launch_date,@orbit_data_state,@data_source_mode,@sim_eligible,@lifecycle_state,@origin,@created_by,
         @created_at,@updated_at,@archived_at)`,
    ).run({ ...row, created_by: createdBy } as Record<string, unknown>);
    return serializeSatellite(getSatelliteRow(String(row.id))!);
  });
}

const UPDATABLE = new Set(['name', 'mission', 'description', 'orbit_type', 'norad_catalog_id', 'tle_line1', 'tle_line2', 'altitude', 'velocity', 'inclination', 'orbital_period_min', 'latitude', 'longitude', 'launch_date', 'sim_eligible']);

export function updateSatellite(id: string, patch: SatelliteUpdateInput): Satellite {
  const existing = getSatelliteRow(id);
  if (!existing) throw new SatelliteNotFoundError(`Satellite ${id} not found`);
  // Whitelist only (mass-assignment safe). Merge with existing, re-validate.
  const merged: SatelliteCreateInput = {
    id, name: existing.name, mission: existing.mission,
    description: existing.description ?? null, orbit_type: existing.orbit_type,
    norad_catalog_id: existing.norad_catalog_id ?? null, tle_line1: existing.tle_line1 ?? null, tle_line2: existing.tle_line2 ?? null,
    altitude: existing.altitude || null, velocity: existing.velocity || null, inclination: existing.inclination ?? null,
    orbital_period_min: existing.orbital_period_min ?? null, latitude: existing.latitude || null, longitude: existing.longitude || null,
    launch_date: existing.launch_date ?? null, sim_eligible: (existing.sim_eligible ?? 1) === 1,
  };
  for (const [k, v] of Object.entries(patch)) {
    if (!UPDATABLE.has(k)) continue; // ignore unknown / protected fields
    (merged as unknown as Record<string, unknown>)[k] = v;
  }
  const { row } = normalizeCreate(merged);
  // NORAD uniqueness against OTHER satellites.
  if (row.norad_catalog_id) {
    const dup = db.prepare('SELECT id FROM satellites WHERE norad_catalog_id = ? AND id != ?').get(row.norad_catalog_id, id) as { id: string } | undefined;
    if (dup) throw new SatelliteConflictError(`NORAD catalog id ${row.norad_catalog_id} already registered to ${dup.id}`);
  }
  db.prepare(
    `UPDATE satellites SET name=@name, display_name=@name, mission=@mission, description=@description, orbit_type=@orbit_type,
       norad_id=@norad_id, norad_catalog_id=@norad_catalog_id, tle_line1=@tle_line1, tle_line2=@tle_line2,
       inclination=@inclination, orbital_period_min=@orbital_period_min, altitude=@altitude, velocity=@velocity,
       latitude=@latitude, longitude=@longitude, launch_date=@launch_date, orbit_data_state=@orbit_data_state,
       sim_eligible=@sim_eligible, updated_at=@updated_at WHERE id=@id`,
  ).run({
    id, name: row.name, mission: row.mission, description: row.description, orbit_type: row.orbit_type,
    norad_id: row.norad_id, norad_catalog_id: row.norad_catalog_id, tle_line1: row.tle_line1, tle_line2: row.tle_line2,
    inclination: row.inclination, orbital_period_min: row.orbital_period_min, altitude: row.altitude, velocity: row.velocity,
    latitude: row.latitude, longitude: row.longitude, launch_date: row.launch_date, orbit_data_state: row.orbit_data_state,
    sim_eligible: row.sim_eligible, updated_at: now(),
  } as Record<string, unknown>);
  return serializeSatellite(getSatelliteRow(id)!);
}

export function archiveSatellite(id: string): Satellite {
  const existing = getSatelliteRow(id);
  if (!existing) throw new SatelliteNotFoundError(`Satellite ${id} not found`);
  db.prepare(`UPDATE satellites SET lifecycle_state='ARCHIVED', archived_at=?, updated_at=? WHERE id=?`).run(now(), now(), id);
  return serializeSatellite(getSatelliteRow(id)!);
}

export function reactivateSatellite(id: string): Satellite {
  const existing = getSatelliteRow(id);
  if (!existing) throw new SatelliteNotFoundError(`Satellite ${id} not found`);
  db.prepare(`UPDATE satellites SET lifecycle_state='ACTIVE', archived_at=NULL, updated_at=? WHERE id=?`).run(now(), id);
  return serializeSatellite(getSatelliteRow(id)!);
}

/**
 * List satellites; archived excluded by default (documented policy). Serialized
 * so `status` reflects the effective (manual-aware) status everywhere.
 */
export function listSatellites(opts: { includeArchived?: boolean } = {}): Satellite[] {
  const all = getAllSatellites();
  const filtered = opts.includeArchived ? all : all.filter((s) => (s.lifecycle_state ?? 'ACTIVE') !== 'ARCHIVED');
  return filtered.map(serializeSatellite);
}

export function getSatelliteById(id: string): Satellite | undefined {
  const row = getSatelliteRow(id);
  return row ? serializeSatellite(row) : undefined;
}

/** Exact/normalized (uppercased) satellite resolution — never substring. Serialized. */
export function resolveSatelliteExact(candidate: string): Satellite | undefined {
  const id = String(candidate ?? '').trim().toUpperCase();
  if (!id) return undefined;
  const row = getSatelliteRow(id);
  return row ? serializeSatellite(row) : undefined;
}

/** Bounded list of registered (active) satellite ids, for a NOT_FOUND hint. */
export function listSatelliteIds(opts: { includeArchived?: boolean; limit?: number } = {}): string[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  return listSatellites({ includeArchived: opts.includeArchived }).slice(0, limit).map((s) => s.id);
}

/** Eligible for simulation: active + sim_eligible. */
export function isSimEligible(s: Satellite): boolean {
  return (s.lifecycle_state ?? 'ACTIVE') === 'ACTIVE' && (s.sim_eligible ?? 1) === 1;
}

// ---------------------------------------------------------------------------
// Manual status control
// ---------------------------------------------------------------------------

export interface SatelliteStatusUpdateInput {
  mode: SatelliteStatusMode;
  status?: ManualSatelliteStatus | null;
  reason?: string | null;
}

export interface SatelliteStatusResult {
  satelliteId: string;
  statusMode: SatelliteStatusMode;
  manualStatus: ManualSatelliteStatus | null;
  derivedStatus: string;
  effectiveStatus: string;
  manualStatusReason: string | null;
  manualStatusUpdatedAt: string | null;
  manualStatusUpdatedBy: string | null;
  satellite: Satellite;
}

/**
 * Set or clear a satellite's manual status override. AUTO clears the override
 * and returns to the telemetry-derived status; MANUAL requires a canonical
 * status. Every change writes an immutable audit record. This NEVER touches
 * telemetry, alerts, investigations, RCA, evidence, or the derived `status`
 * column — it is a display/operational override only.
 */
export function setSatelliteStatus(
  id: string,
  input: SatelliteStatusUpdateInput,
  actor: { id: string; role?: string },
): SatelliteStatusResult {
  const errors: Record<string, string> = {};

  const mode = typeof input.mode === 'string' ? input.mode.toUpperCase() : input.mode;
  if (!isStatusMode(mode)) errors.mode = `mode must be one of ${STATUS_MODE_VALUES.join(', ')}`;

  let manualStatus: ManualSatelliteStatus | null = null;
  if (mode === 'MANUAL') {
    const s = typeof input.status === 'string' ? input.status.toUpperCase() : input.status;
    if (!isManualStatus(s)) errors.status = `status must be one of ${MANUAL_STATUS_VALUES.join(', ')} when mode is MANUAL`;
    else manualStatus = s;
  } else if (input.status != null && String(input.status).trim() !== '') {
    // AUTO must not carry a manual status.
    errors.status = 'status must be omitted when mode is AUTO';
  }

  let reason: string | null = null;
  if (input.reason != null) {
    const r = String(input.reason).trim();
    if (r.length > MAX_STATUS_REASON_LEN) errors.reason = `reason must be ≤ ${MAX_STATUS_REASON_LEN} characters`;
    else reason = r || null;
  }

  if (Object.keys(errors).length) throw new SatelliteValidationError('Invalid status update', errors);

  // Exact (case-normalized) resolution — satellite ids are stored uppercase. Never substring.
  const satId = String(id ?? '').trim().toUpperCase();

  return transaction(() => {
    const existing = getSatelliteRow(satId);
    if (!existing) throw new SatelliteNotFoundError(`Satellite ${satId} not found`);
    id = satId;
    const before = resolveSatelliteStatus(existing);
    const ts = now();

    if (mode === 'MANUAL') {
      db.prepare(
        `UPDATE satellites SET status_mode='MANUAL', manual_status=?, manual_status_reason=?,
           manual_status_updated_at=?, manual_status_updated_by=?, updated_at=? WHERE id=?`,
      ).run(manualStatus, reason, ts, actor.id, ts, id);
    } else {
      db.prepare(
        `UPDATE satellites SET status_mode='AUTO', manual_status=NULL, manual_status_reason=?,
           manual_status_updated_at=?, manual_status_updated_by=?, updated_at=? WHERE id=?`,
      ).run(reason, ts, actor.id, ts, id);
    }

    const updated = serializeSatellite(getSatelliteRow(id)!);
    const after = resolveSatelliteStatus(getSatelliteRow(id)!);

    db.prepare(
      `INSERT INTO satellite_status_events
        (satellite_id, previous_mode, previous_manual_status, previous_effective_status,
         new_mode, new_manual_status, new_effective_status, reason, actor, actor_role, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, before.statusMode, before.manualStatus, before.effectiveStatus,
      after.statusMode, after.manualStatus, after.effectiveStatus, reason, actor.id, actor.role ?? null, ts,
    );

    return {
      satelliteId: id,
      statusMode: after.statusMode,
      manualStatus: after.manualStatus,
      derivedStatus: after.derivedStatus,
      effectiveStatus: after.effectiveStatus,
      manualStatusReason: after.manualStatusReason,
      manualStatusUpdatedAt: after.manualStatusUpdatedAt,
      manualStatusUpdatedBy: after.manualStatusUpdatedBy,
      satellite: updated,
    };
  });
}

/** Bounded, newest-first manual-status change history for a satellite. */
export function listSatelliteStatusHistory(id: string, limit = 50): SatelliteStatusEvent[] {
  const n = Math.max(1, Math.min(limit, 200));
  return db
    .prepare(`SELECT * FROM satellite_status_events WHERE satellite_id = ? ORDER BY id DESC LIMIT ?`)
    .all(id, n) as SatelliteStatusEvent[];
}

/**
 * Find any PERSISTED satellite id mentioned in free text (dynamic — not a
 * hardcoded ORION pattern). Matches the longest id present as a whole token so
 * a manually-registered satellite (e.g. SAT-NEW-001) is recognized everywhere
 * the seeded fleet is. Returns the canonical stored id, or null.
 */
export function findSatelliteIdInText(text: string): string | null {
  if (!text) return null;
  const upper = String(text).toUpperCase();
  const ids = (db.prepare('SELECT id FROM satellites').all() as { id: string }[])
    .map((r) => r.id)
    .sort((a, b) => b.length - a.length); // longest-first so SAT-NEW-001 wins over SAT-NEW
  for (const id of ids) {
    const esc = id.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![A-Z0-9])${esc}(?![A-Z0-9])`).test(upper)) return id;
  }
  return null;
}
