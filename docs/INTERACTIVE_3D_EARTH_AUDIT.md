# Interactive 3D Earth Orbit Visualization — Pre-Implementation Audit

Reconnaissance before replacing the flat 2D orbit visualization with a genuine
WebGL 3D Earth globe. Read-only; no runtime behavior changed during the audit.

## 1. Current implementation

- **Orbit page:** [frontend/src/pages/OrbitPage.tsx](../frontend/src/pages/OrbitPage.tsx)
  polls `api.satellites()` (3 s) and renders `<OrbitMap satellites={plottable} height={480}/>`
  plus a Fleet Register list. `plottable` = satellites whose `orbit_data_state !==
  'UNAVAILABLE'` and `altitude > 0`.
- **2D map:** [frontend/src/components/OrbitMap.tsx](../frontend/src/components/OrbitMap.tsx)
  — an **SVG** diagram: `<circle>` Earth + dashed orbit rings by `orbit_type`,
  satellites placed on rings at an angle derived from `longitude`. Status color,
  hover tooltip, click→`/satellites/:id`, a status `<select>`, reset + expand.
  This is the flat visualization to be replaced.
- **Dashboard Live Orbit Map:** [frontend/src/pages/DashboardPage.tsx](../frontend/src/pages/DashboardPage.tsx)
  line 74-75 renders the **same** `<OrbitMap satellites={s.satellites} height={380}/>`
  (from `dashboardSummary().satellites`). Both surfaces share one component today —
  we will keep one shared renderer.

## 2. 3D rendering libraries

- **None installed.** `frontend/package.json` had only `recharts` (2D charts),
  `lucide-react`, `react`, `react-router-dom`. No three / R3F / drei / globe.gl /
  Cesium.
- Stack: **React 18.3.1**, Vite 5.4, TypeScript 5.7, Vitest 2 (jsdom).
- **Chosen approach (Option B):** add `three` + `@react-three/fiber` +
  `@react-three/drei`. `@react-three/fiber@9` requires React 19, so we pin the
  **React-18-compatible** line: `three@0.170.0`, `@react-three/fiber@8.18.0`
  (peer `react >=18 <19`), `@react-three/drei@9.122.0`, `@types/three@0.170.0`.
  This is genuine WebGL, integrates with the existing React tree, and needs no
  build-system change (Vite handles it).

## 3. Satellite / orbit data model

`Satellite` ([frontend/src/types.ts](../frontend/src/types.ts) / backend
`types.ts`) exposes, per satellite:

- Orbit metadata: `orbit_type` (LEO | MEO | GEO | HEO | SSO | POLAR | OTHER |
  UNKNOWN), `altitude` (km), `velocity`, `inclination?`, `orbital_period_min?`,
  `latitude`, `longitude`, `tle_line1?`, `tle_line2?`.
- Honest states: `orbit_data_state` (REAL_EXTERNAL | MANUALLY_PROVIDED |
  UNAVAILABLE), `data_source_mode` (NO_TELEMETRY | SIMULATED | EXTERNAL).
- Status: **`status` = effective status** (serialized), plus explicit
  `derived_status`, `effective_status`, `status_mode` (AUTO|MANUAL),
  `manual_status`. (Delivered by the prior Manual Status Control work —
  `serializeSatellite` sets `status` to the effective value fleet-wide.)
- Identity/relations: `id`, `name`, `display_name`, `mission`, `norad_catalog_id`,
  `lifecycle_state` (ACTIVE|ARCHIVED), `sim_eligible`.

Answers to the audit questions:

1. Installed 3D libs: none → add three + R3F v8 + drei v9.
2. n/a (none present).
3. Orbit params: persisted satellite columns (above); no live position endpoint.
4. Satellites with sufficient orbit data: those with `altitude > 0` and
   `orbit_data_state !== 'UNAVAILABLE'` (same rule the 2D map uses).
5. `effectiveStatus`: exposed as the serialized `status` field **and** explicit
   `effective_status` / `derived_status` / `status_mode`.
6. Current position data: `latitude`/`longitude` (from telemetry-driven rows) +
   `altitude`; no continuous ECI position endpoint.
7. TLE/SGP4 propagation: **not implemented** (TLE lines may be stored as metadata
   but there is no SGP4 propagator in the codebase).
8. Backend fields available: `inclination`, `altitude`, `latitude`, `longitude`,
   `orbit_type`, `orbital_period_min`, `tle_line1/2`. No RAAN / eccentricity /
   argument-of-perigee / mean-anomaly columns.
9. Realtime: **polling** via `usePolling(fn, ms)` (3 s). No WebSocket/SSE. The
   globe will refresh through the same polling hook (cache-free, silent refetch),
   so satellite-add / manual-status / archive changes appear automatically.

## 4. Positioning strategy (given the data)

No SGP4 and no full classical elements exist, so precise propagation is not
possible. Positioning hierarchy actually available here:

1. PROPAGATED (SGP4) — **unavailable** (no propagator).
2. ECI/ECEF — **unavailable**.
3. **LAT_LON_ALT** — available when a satellite has real `latitude`/`longitude`
   from telemetry + `altitude` → placed at the true sub-satellite point & radius.
4. Classical elements — partial (`inclination` only) → not enough alone.
5. **DETERMINISTIC_VISUALIZATION** — documented fallback for satellites with only
   `orbit_type` + `altitude` (no lat/lon). A stable hash of the satellite **id**
   seeds the along-orbit phase and node longitude; `inclination` (or an
   orbit-type default) sets the plane tilt. Deterministic (same id → same place
   across refresh), never `Math.random`, never claims to be telemetry.

Each rendered satellite carries a bounded **positionMode** badge: `LAT_LON_ALT`
or `DETERMINISTIC_VISUALIZATION` (the enum also defines `PROPAGATED` /
`ORBIT_ELEMENTS` for future data), surfaced in the tooltip/details panel so
deterministic placement is never mislabeled as real telemetry.

## 5. Scale transform (documented)

Literal altitude scale is unusable (GEO ≈ 5.6 Earth radii, LEO ≈ 1.03). We use a
bounded, monotonic `altitudeKmToSceneRadius()` (Earth radius = 1 scene unit) that
compresses the range so LEO < MEO < GEO ordering is preserved, satellites never
intersect the surface (min radius > 1), and GEO stays interactable (bounded max).
Centralized in `orbitMath.ts`; unit-tested.

## 6. AppShell / responsive / assets / CSP

- `<main>` is `min-w-0 flex-1 overflow-y-auto`; the globe panel lives inside a
  `Panel`. Sidebar toggles `lg:w-64` / `lg:w-[68px]`; the canvas uses a
  ResizeObserver-friendly responsive container so it reflows on sidebar toggle.
- Assets: `public/` did not exist → created `public/assets/earth/` with local
  `earth_day_2048.jpg`, `earth_night_2048.png`, `earth_specular_2048.jpg`
  (NASA Blue Marble derivatives from the MIT-licensed three.js examples repo;
  underlying imagery is NASA, public domain — see `public/assets/earth/LICENSE.md`).
  No runtime external fetch, no API keys, no iframe. Stars are generated in-scene
  (drei `<Stars>`), no asset needed. CSP-safe (same-origin static assets only).

## Chosen module layout

`components/orbit3d/`: `orbitMath.ts`, `orbitTypes.ts`, `orbitStatus.ts` (pure,
tested), `Earth.tsx`, `SatelliteMarker.tsx`, `OrbitPath.tsx`,
`InteractiveEarthGlobe.tsx`, `GlobeControlsPanel.tsx`, `SatelliteTooltip.tsx`,
`SatelliteDetailsPanel.tsx`. Orbit page = full mode (filters, details, fullscreen,
reset, auto-rotate); Dashboard = compact mode. One renderer, shared.
