import { Link } from 'react-router-dom';
import { Orbit } from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { ErrorState, LoadingState, Panel } from '../components/ui';
import { InteractiveEarthGlobe } from '../components/orbit3d/InteractiveEarthGlobe';
import { isPlottable } from '../components/orbit3d/orbitMath';
import { healthBarColor, statusColor } from '../lib/format';

export default function OrbitPage() {
  const sats = usePolling(() => api.satellites(), 3000);

  if (sats.loading) return <LoadingState label="Loading orbital picture…" />;
  if (sats.error || !sats.data) return <ErrorState message={sats.error ?? 'No data'} onRetry={sats.refetch} />;

  // Only satellites with real/manually-provided orbit data may be plotted. A
  // manually-registered satellite without orbit data is NEVER placed at a fake
  // position — it is shown as "orbit data unavailable" in the register.
  const plottable = sats.data.filter(isPlottable);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Orbit className="h-6 w-6 text-accent-blue" /> Orbit &amp; Trajectory</h1>
        <p className="text-sm text-slate-400">Interactive 3D orbital picture of {plottable.length} of {sats.data.length} satellites (others have no orbit data)</p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Orbital Map" className="xl:col-span-2" bodyClassName="p-0">
          <InteractiveEarthGlobe satellites={sats.data} mode="full" height={520} />
        </Panel>
        <Panel title="Fleet Register" bodyClassName="p-0">
          <ul className="divide-y divide-space-700">
            {sats.data.map((s) => {
              const unavailable = (s.orbit_data_state ?? 'MANUALLY_PROVIDED') === 'UNAVAILABLE' || s.altitude <= 0;
              return (
                <li key={s.id}>
                  <Link to={`/satellites/${s.id}`} className="block px-4 py-3 hover:bg-space-800">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{s.display_name || s.name}</span>
                      <span className={`text-xs font-semibold uppercase ${statusColor(s.status)}`}>{s.status}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{unavailable ? `${s.orbit_type} · orbit data unavailable` : `${s.orbit_type} · ${Math.round(s.altitude)} km`} · {s.mission}</div>
                    {s.status !== 'UNKNOWN' && s.data_source_mode !== 'NO_TELEMETRY' && (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-space-700">
                        <div className={`h-full ${healthBarColor(s.health_score)}`} style={{ width: `${Math.max(2, s.health_score)}%` }} />
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
