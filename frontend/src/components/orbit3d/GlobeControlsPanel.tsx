import { Crosshair, Maximize2, Minimize2, RotateCw, Pause } from 'lucide-react';
import { STATUS_FILTERS, type StatusFilter } from './orbitStatus';
import { ORBIT_FILTERS, type OrbitFilter } from './orbitMath';

const selCls = 'rounded-md border border-space-600 bg-space-800/90 px-2 py-1 text-xs text-slate-200 focus:border-accent-cyan focus:outline-none';
const btnCls = 'rounded-md border border-space-600 bg-space-800/90 p-1.5 text-slate-300 hover:bg-space-700';

export interface GlobeControlsProps {
  mode: 'full' | 'compact';
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  orbitFilter: OrbitFilter;
  setOrbitFilter: (v: OrbitFilter) => void;
  autoRotate: boolean;
  setAutoRotate: (v: boolean) => void;
  onReset: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Floating controls (upper-right). Full mode shows filters + auto-rotate +
 *  reset + fullscreen; compact mode shows only fullscreen. */
export function GlobeControlsPanel(p: GlobeControlsProps) {
  return (
    <div className="absolute right-3 top-3 z-20 flex flex-wrap items-center justify-end gap-2">
      {p.mode === 'full' && (
        <>
          <select aria-label="Status filter" value={p.statusFilter} onChange={(e) => p.setStatusFilter(e.target.value as StatusFilter)} className={selCls}>
            {STATUS_FILTERS.map((f) => <option key={f} value={f}>{f === 'ALL' ? 'All statuses' : f}</option>)}
          </select>
          <select aria-label="Orbit filter" value={p.orbitFilter} onChange={(e) => p.setOrbitFilter(e.target.value as OrbitFilter)} className={selCls}>
            {ORBIT_FILTERS.map((f) => <option key={f} value={f}>{f === 'ALL' ? 'All orbits' : f}</option>)}
          </select>
          <button onClick={() => p.setAutoRotate(!p.autoRotate)} className={`${btnCls} ${p.autoRotate ? 'text-accent-cyan' : ''}`} title={p.autoRotate ? 'Pause auto-rotate' : 'Auto-rotate'}>
            {p.autoRotate ? <Pause className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />}
          </button>
          <button onClick={p.onReset} className={btnCls} title="Reset view"><Crosshair className="h-4 w-4" /></button>
        </>
      )}
      <button onClick={p.onToggleFullscreen} className={btnCls} title={p.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        {p.isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
