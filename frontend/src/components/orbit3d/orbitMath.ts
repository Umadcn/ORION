// Pure, framework-free orbit math for the 3D globe. All scale constants live
// here (never scattered across components) and every function is deterministic
// and unit-tested. Earth radius is the scene unit (1.0).
import type { Satellite } from '../../types';
import { effectiveStatusOf, passesStatusFilter, type StatusFilter } from './orbitStatus';
import type { OrbitCategory, PlottedSatellite, PositionMode } from './orbitTypes';

export const EARTH_RADIUS = 1; // scene units
const DEG2RAD = Math.PI / 180;

// --- Scale transform ------------------------------------------------------
// Literal altitude scale is unusable (GEO ≈ 5.6 Earth radii). Compress with a
// bounded, monotonic log so LEO < MEO < GEO ordering holds, markers never touch
// the surface (min > EARTH_RADIUS), and GEO stays interactable (bounded max).
const SCENE_MIN_RADIUS = 1.3;   // > EARTH_RADIUS ⇒ always above the surface
const SCENE_MAX_RADIUS = 4.2;   // GEO stays reachable
const SCALE_K = 1.1;

/** Monotonic, bounded altitude(km) → scene radius. */
export function altitudeKmToSceneRadius(altitudeKm: number): number {
  const alt = Number.isFinite(altitudeKm) && altitudeKm > 0 ? altitudeKm : 0;
  const r = SCENE_MIN_RADIUS + SCALE_K * Math.log10(1 + alt / 500);
  return Math.min(SCENE_MAX_RADIUS, Math.max(SCENE_MIN_RADIUS, r));
}

// --- Orbit categorization -------------------------------------------------
export function orbitCategoryOf(sat: Pick<Satellite, 'orbit_type' | 'altitude'>): OrbitCategory {
  const t = String(sat.orbit_type ?? '').toUpperCase();
  if (t === 'HEO') return 'HEO';
  if (t === 'GEO') return 'GEO';
  if (t === 'MEO') return 'MEO';
  if (t === 'LEO' || t === 'SSO' || t === 'POLAR') return 'LEO';
  // Infer from altitude when the type is OTHER/UNKNOWN.
  const alt = sat.altitude ?? 0;
  if (alt <= 0) return 'OTHER';
  if (alt < 2000) return 'LEO';
  if (alt < 34000) return 'MEO';
  return 'GEO';
}

const DEFAULT_INCLINATION: Record<OrbitCategory, number> = {
  LEO: 51, MEO: 55, GEO: 0.5, HEO: 63, OTHER: 45,
};

// --- Deterministic id hash (djb2) → stable pseudo-values ------------------
export function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
/** Deterministic float in [0,1) from a satellite id + salt. */
function unit(id: string, salt: number): number {
  return (hashId(`${id}#${salt}`) % 100000) / 100000;
}

// --- Geographic ↔ scene vector (single mapping, matches the Earth texture) --
/** (lat°, lon°) on a unit sphere → scene unit vector. */
export function latLonToUnitVector(latDeg: number, lonDeg: number): [number, number, number] {
  const phi = (90 - latDeg) * DEG2RAD;      // polar angle from +Y
  const theta = (lonDeg + 180) * DEG2RAD;   // azimuth
  const s = Math.sin(phi);
  return [-s * Math.cos(theta), Math.cos(phi), s * Math.sin(theta)];
}

/**
 * Geographic sub-point of a circular orbit of inclination `i` at phase `a`,
 * with ascending node at longitude `node`. Returns [latDeg, lonDeg].
 */
export function orbitPointGeographic(iDeg: number, nodeDeg: number, aRad: number): [number, number] {
  const i = iDeg * DEG2RAD;
  const lat = Math.asin(Math.sin(i) * Math.sin(aRad)) / DEG2RAD;
  const lon = nodeDeg + Math.atan2(Math.cos(i) * Math.sin(aRad), Math.cos(aRad)) / DEG2RAD;
  return [lat, ((lon + 540) % 360) - 180];
}

/** Scene coordinates for an orbit point at scene radius. */
export function orbitPositionToSceneCoordinates(
  iDeg: number, nodeDeg: number, aRad: number, sceneRadius: number,
): [number, number, number] {
  const [lat, lon] = orbitPointGeographic(iDeg, nodeDeg, aRad);
  const v = latLonToUnitVector(lat, lon);
  return [v[0] * sceneRadius, v[1] * sceneRadius, v[2] * sceneRadius];
}

// --- Position mode decision ------------------------------------------------
function hasRealSubPoint(sat: Satellite): boolean {
  const telemetry = sat.data_source_mode === 'SIMULATED' || sat.data_source_mode === 'EXTERNAL';
  const lat = sat.latitude, lon = sat.longitude;
  return telemetry && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
}

/** True when a satellite has enough orbit data to be plotted at all. */
export function isPlottable(sat: Satellite): boolean {
  return (sat.orbit_data_state ?? 'MANUALLY_PROVIDED') !== 'UNAVAILABLE' && (sat.altitude ?? 0) > 0;
}

/**
 * Resolve a satellite to a stable scene placement + orbit geometry. Returns null
 * when it lacks orbit data. LAT_LON_ALT uses the real sub-satellite point;
 * otherwise a deterministic (id-seeded) visualization placement is used — the
 * marker always lies exactly on its own rendered orbit ring.
 */
export function buildPlottedSatellite(sat: Satellite): PlottedSatellite | null {
  if (!isPlottable(sat)) return null;
  const category = orbitCategoryOf(sat);
  const sceneRadius = altitudeKmToSceneRadius(sat.altitude);
  const storedInc = Number.isFinite(sat.inclination as number) && (sat.inclination as number) > 0
    ? (sat.inclination as number) : 0;

  let inclinationDeg: number;
  let nodeLongitudeDeg: number;
  let phase: number;
  let positionMode: PositionMode;

  if (hasRealSubPoint(sat)) {
    positionMode = 'LAT_LON_ALT';
    const lat = sat.latitude, lon = sat.longitude;
    // Choose an inclination that can pass through this latitude, then solve the
    // phase + node so the marker lands exactly at (lat, lon) on its ring.
    inclinationDeg = Math.min(90, Math.max(storedInc, Math.abs(lat) + 3));
    const i = inclinationDeg * DEG2RAD;
    const sinA = Math.max(-1, Math.min(1, Math.sin(lat * DEG2RAD) / Math.sin(i)));
    phase = Math.asin(sinA);
    const lonOffset = Math.atan2(Math.cos(i) * Math.sin(phase), Math.cos(phase)) / DEG2RAD;
    nodeLongitudeDeg = lon - lonOffset;
  } else {
    positionMode = 'DETERMINISTIC_VISUALIZATION';
    inclinationDeg = storedInc > 0 ? storedInc : DEFAULT_INCLINATION[category];
    nodeLongitudeDeg = unit(sat.id, 1) * 360 - 180;
    phase = unit(sat.id, 2) * 2 * Math.PI;
  }

  const position = orbitPositionToSceneCoordinates(inclinationDeg, nodeLongitudeDeg, phase, sceneRadius);
  return {
    id: sat.id,
    satellite: sat,
    position,
    sceneRadius,
    category,
    inclinationDeg,
    nodeLongitudeDeg,
    positionMode,
    status: effectiveStatusOf(sat),
  };
}

/** Sampled scene points forming the closed orbit ring for a plotted satellite. */
export function orbitPathPoints(p: PlottedSatellite, segments = 128): [number, number, number][] {
  const n = Math.max(16, Math.min(256, segments));
  const pts: [number, number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * 2 * Math.PI;
    pts.push(orbitPositionToSceneCoordinates(p.inclinationDeg, p.nodeLongitudeDeg, a, p.sceneRadius));
  }
  return pts;
}

// --- Filtering -------------------------------------------------------------
export type OrbitFilter = 'ALL' | 'LEO' | 'MEO' | 'GEO' | 'HEO';
export const ORBIT_FILTERS: OrbitFilter[] = ['ALL', 'LEO', 'MEO', 'GEO', 'HEO'];

export function passesOrbitFilter(category: OrbitCategory, filter: OrbitFilter): boolean {
  return filter === 'ALL' || category === filter;
}

export interface GlobeSelection {
  plotted: PlottedSatellite[];
  /** Active (non-archived) satellites considered. */
  total: number;
  /** Active satellites omitted because they have no orbit data. */
  withoutOrbitData: number;
  /** Plottable satellites hidden by the current status/orbit filters. */
  hiddenByFilter: number;
}

/**
 * Deterministically resolve the satellites to render for the given filters.
 * Archived satellites are excluded (consistent with the fleet list). Pure — no
 * WebGL, no mutation — so it is fully unit-testable.
 */
export function selectPlotted(
  satellites: Satellite[],
  statusFilter: StatusFilter,
  orbitFilter: OrbitFilter,
): GlobeSelection {
  const active = (satellites ?? []).filter((s) => (s.lifecycle_state ?? 'ACTIVE') !== 'ARCHIVED');
  let withoutOrbitData = 0;
  let hiddenByFilter = 0;
  const plotted: PlottedSatellite[] = [];
  for (const sat of active) {
    const p = buildPlottedSatellite(sat);
    if (!p) { withoutOrbitData++; continue; }
    if (!passesStatusFilter(sat, statusFilter) || !passesOrbitFilter(p.category, orbitFilter)) {
      hiddenByFilter++;
      continue;
    }
    plotted.push(p);
  }
  return { plotted, total: active.length, withoutOrbitData, hiddenByFilter };
}
