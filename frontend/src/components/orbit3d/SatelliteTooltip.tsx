import { statusColorHex } from './orbitStatus';
import { POSITION_MODE_LABEL } from './orbitTypes';
import type { PlottedSatellite } from './orbitTypes';

/**
 * Hover tooltip — a fixed-position card that follows the pointer and is clamped
 * inside the viewport. Shows authoritative satellite data + the visualization
 * position mode so deterministic placement is never mistaken for telemetry.
 */
export function SatelliteTooltip({ plotted, x, y }: { plotted: PlottedSatellite; x: number; y: number }) {
  const s = plotted.satellite;
  const W = 232;
  const left = Math.min(x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1920) - W - 8);
  const top = Math.max(8, Math.min(y + 14, (typeof window !== 'undefined' ? window.innerHeight : 1080) - 150));
  const manual = s.status_mode === 'MANUAL';

  return (
    <div
      className="pointer-events-none fixed z-[60] rounded-lg border border-space-600 bg-space-850/95 px-3 py-2 text-xs shadow-panel backdrop-blur"
      style={{ left, top, width: W }}
    >
      <div className="truncate font-semibold text-white" title={s.display_name || s.name}>{s.display_name || s.name}</div>
      <div className="truncate text-slate-400" title={s.mission}>{s.mission}</div>
      <div className="mt-1 text-slate-500">{s.orbit_type} · {Math.round(s.altitude)} km</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-semibold" style={{ color: statusColorHex(plotted.status) }}>{plotted.status}</span>
        <span className="rounded bg-space-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-300">{manual ? 'Manual' : 'Auto'}</span>
      </div>
      <div className="mt-1 text-[10px] text-slate-500">Position: {POSITION_MODE_LABEL[plotted.positionMode]}</div>
    </div>
  );
}
