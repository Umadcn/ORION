import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Satellite } from '../types';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../auth/AuthContext';
import { ErrorState, LoadingState } from '../components/ui';
import { SatelliteFormModal } from '../components/SatelliteFormModal';
import { healthBarColor, statusColor } from '../lib/format';
import { healthLabel, altitudeLabel, satelliteHasTelemetry, isArchived, isManual } from '../lib/satellite';
import { CircleDot, Plus, Archive } from 'lucide-react';

export default function SatellitesPage() {
  const { user } = useAuth();
  const canCreate = user?.role === 'MISSION_DIRECTOR' || user?.role === 'SYSTEM_ADMIN';
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const sats = usePolling(() => api.satellites(includeArchived), 3000);

  if (sats.loading) return <LoadingState />;
  if (sats.error || !sats.data) return <ErrorState message={sats.error ?? 'No data'} onRetry={sats.refetch} />;

  const active = sats.data.filter((s) => !isArchived(s));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Satellites</h1>
          <p className="text-sm text-slate-400">{active.length} active satellite{active.length === 1 ? '' : 's'} in the mission fleet</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={includeArchived} onChange={(e) => { setIncludeArchived(e.target.checked); setTimeout(sats.refetch, 0); }} /> Show archived
          </label>
          {canCreate && (
            <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add satellite</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sats.data.map((s) => (
          <Link key={s.id} to={`/satellites/${s.id}`} className={`panel block p-5 transition-colors hover:border-space-500 ${isArchived(s) ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CircleDot className={`h-3.5 w-3.5 ${statusColor(s.status)}`} />
                <span className="text-lg font-bold text-white">{s.display_name || s.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {isManual(s) && <span className="rounded-full bg-accent-cyan/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-cyan">Manual</span>}
                {isArchived(s) && <span className="flex items-center gap-0.5 text-[9px] uppercase text-slate-500"><Archive className="h-3 w-3" />Archived</span>}
                <span className={`text-xs font-semibold uppercase ${statusColor(s.status)}`}>{s.status}</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
              <div className="text-slate-500">Mission</div><div className="text-right text-slate-200">{s.mission}</div>
              <div className="text-slate-500">Orbit</div><div className="text-right text-slate-200">{s.orbit_type}</div>
              <div className="text-slate-500">NORAD ID</div><div className="text-right font-mono text-slate-200">{s.norad_catalog_id || s.norad_id || '—'}</div>
              <div className="text-slate-500">Altitude</div>
              <div className="text-right font-mono text-slate-200">{altitudeLabel(s)}</div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
              <span>Health</span>
              <span className="font-mono text-slate-200">{healthLabel(s)}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-space-700">
              {satelliteHasTelemetry(s)
                ? <div className={`h-full ${healthBarColor(s.health_score)}`} style={{ width: `${Math.max(2, s.health_score)}%` }} />
                : <div className="h-full w-full bg-space-600" />}
            </div>
          </Link>
        ))}
      </div>

      {showAdd && <SatelliteFormModal onClose={() => setShowAdd(false)} onSaved={(_s: Satellite) => { setShowAdd(false); sats.refetch(); }} />}
    </div>
  );
}
