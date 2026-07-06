// Shared types for the 3D orbit visualization. Kept framework-free so the
// positioning/scale/status logic can be unit-tested without WebGL.
import type { Satellite, SatelliteStatus } from '../../types';

/** How authoritative a satellite's rendered position is. */
export type PositionMode =
  | 'PROPAGATED'                 // from SGP4/TLE (not available in this build)
  | 'ORBIT_ELEMENTS'            // from full classical elements (not available)
  | 'LAT_LON_ALT'               // from real sub-satellite lat/lon + altitude
  | 'DETERMINISTIC_VISUALIZATION'; // stable id-seeded placement (documented, not telemetry)

export const POSITION_MODE_LABEL: Record<PositionMode, string> = {
  PROPAGATED: 'Propagated (SGP4)',
  ORBIT_ELEMENTS: 'Orbital elements',
  LAT_LON_ALT: 'Sub-satellite point',
  DETERMINISTIC_VISUALIZATION: 'Deterministic visualization',
};

/** Canonical orbit categories the visualization understands. */
export type OrbitCategory = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'OTHER';

/** A satellite prepared for rendering: scene position + orbit geometry + metadata. */
export interface PlottedSatellite {
  id: string;
  satellite: Satellite;
  /** Unit-vector direction * scene radius (Earth radius = 1). */
  position: [number, number, number];
  sceneRadius: number;
  category: OrbitCategory;
  inclinationDeg: number;
  /** Longitude of ascending node (deg) used to orient the orbit plane. */
  nodeLongitudeDeg: number;
  positionMode: PositionMode;
  status: SatelliteStatus;
}
