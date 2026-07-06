import { Link } from 'react-router-dom';
import { X, Satellite as SatIcon, Activity, AlertTriangle, Search, ExternalLink } from 'lucide-react';
import { api } from '../../api/client';
import { usePolling } from '../../hooks/usePolling';
import { statusColorHex } from './orbitStatus';
import { POSITION_MODE_LABEL } from './orbitTypes';
import type { PlottedSatellite } from './orbitTypes';

/**
 * Compact selection panel. Reuses existing read-only endpoints (satellite detail
 * + latest telemetry) — the globe never mutates mission state. Actions link to
 * existing routes.
 */
export function SatelliteDetailsPanel({ plotted, onClose }: { plotted: PlottedSatellite; onClose: () => void }) {
  const s = plotted.satellite;
  const detail = usePolling(() => api.satellite(s.id), 5000, [s.id]);
  const telemetry = usePolling(() => api.satelliteTelemetry(s.id, 1), 5000, [s.id]);
  const latest = telemetry.data?.[telemetry.data.length - 1];
  const d = detail.data;
  const manual = s.status_mode === 'MANUAL';

  return (
    <div className="absolute bottom-3 left-3 z-20 w-[300px] max-w-[calc(100%-1.5rem)] rounded-xl border border-space-600 bg-space-900/95 p-4 shadow-panel backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-white"><SatIcon className="h-4 w-4 flex-shrink-0 text-accent-cyan" /><span className="truncate font-bold" title={s.display_name || s.name}>{s.display_name || s.name}</span></div>
          <div className="truncate text-xs text-slate-400" title={s.mission}>{s.mission}</div>
        </div>
        <button onClick={onClose} className="flex-shrink-0 text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
        <dt className="text-slate-500">Effective status</dt>
        <dd className="text-right font-semibold" style={{ color: statusColorHex(plotted.status) }}>{plotted.status}</dd>
        {manual && (<><dt className="text-slate-500">Derived status</dt><dd className="text-right text-slate-300">{s.derived_status ?? '—'}</dd></>)}
        <dt className="text-slate-500">Status mode</dt><dd className="text-right text-slate-300">{manual ? 'MANUAL' : 'AUTO'}</dd>
        <dt className="text-slate-500">Orbit</dt><dd className="text-right text-slate-200">{s.orbit_type} · {Math.round(s.altitude)} km</dd>
        {s.norad_catalog_id && (<><dt className="text-slate-500">NORAD</dt><dd className="text-right font-mono text-slate-200">{s.norad_catalog_id}</dd></>)}
        <dt className="text-slate-500">Alerts</dt><dd className="text-right text-slate-200">{d ? d.active_alerts.length : '…'}</dd>
        <dt className="text-slate-500">Investigations</dt><dd className="text-right text-slate-200">{d ? d.investigations.length : '…'}</dd>
        <dt className="text-slate-500">Position</dt><dd className="text-right text-slate-300">{POSITION_MODE_LABEL[plotted.positionMode]}</dd>
      </dl>

      {latest ? (
        <div className="mt-2 rounded-lg border border-space-700 bg-space-800/60 px-2.5 py-1.5 text-[11px] text-slate-400">
          Battery {latest.battery_percent}% · {latest.temperature_c}°C · {latest.signal_strength_dbm} dBm
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-slate-500">No telemetry recorded.</div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Link to={`/satellites/${s.id}`} className="btn-ghost !px-2 !py-1.5 text-[11px]"><ExternalLink className="h-3 w-3" /> Satellite</Link>
        <Link to="/telemetry" className="btn-ghost !px-2 !py-1.5 text-[11px]"><Activity className="h-3 w-3" /> Telemetry</Link>
        <Link to="/alerts" className="btn-ghost !px-2 !py-1.5 text-[11px]"><AlertTriangle className="h-3 w-3" /> Alerts</Link>
        <Link to="/investigations" className="btn-ghost !px-2 !py-1.5 text-[11px]"><Search className="h-3 w-3" /> Investigations</Link>
      </div>
    </div>
  );
}
