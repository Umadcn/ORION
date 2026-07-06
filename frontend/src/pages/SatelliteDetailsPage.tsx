import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../auth/AuthContext';
import { ErrorState, LoadingState, Panel, StatusBadge, EmptyState } from '../components/ui';
import { AlertList } from '../components/domain';
import { TelemetryChart } from '../components/TelemetryChart';
import { SatelliteFormModal } from '../components/SatelliteFormModal';
import { ManageStatusModal } from '../components/ManageStatusModal';
import { healthBarColor, statusColor, timeAgo } from '../lib/format';
import { canManageStatus, isManualOverride, effectiveStatus, derivedStatus } from '../lib/satelliteStatus';
import { Play, Square, Pencil, Archive, RotateCcw, SatelliteDish, ShieldAlert } from 'lucide-react';

export default function SatelliteDetailsPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const canManage = user?.role === 'MISSION_DIRECTOR' || user?.role === 'SYSTEM_ADMIN';
  const canArchive = user?.role === 'SYSTEM_ADMIN';
  const [editing, setEditing] = useState(false);
  const [managingStatus, setManagingStatus] = useState(false);
  const [busy, setBusy] = useState(false);

  const sat = usePolling(() => api.satellite(id), 3000, [id]);
  const telemetry = usePolling(() => api.satelliteTelemetry(id, 80), 3000, [id]);
  const history = usePolling(() => api.satelliteStatusHistory(id, 25), 5000, [id]);

  if (sat.loading) return <LoadingState />;
  if (sat.error || !sat.data) return <ErrorState message={sat.error ?? 'Not found'} onRetry={sat.refetch} />;
  const s = sat.data;
  const latest = telemetry.data?.[telemetry.data.length - 1];
  const noTelemetry = !s.has_telemetry || s.telemetry_state === 'NO_TELEMETRY';
  const orbitUnavailable = (s.orbit_data_state ?? 'UNAVAILABLE') === 'UNAVAILABLE';
  const archived = (s.lifecycle_state ?? 'ACTIVE') === 'ARCHIVED';

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); sat.refetch(); } };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500"><Link to="/satellites" className="hover:underline">Satellites</Link> / {s.id}</div>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold text-white">
            {s.display_name || s.name}
            <span className={`text-sm font-semibold ${statusColor(effectiveStatus(s))}`}>{effectiveStatus(s)}</span>
            {isManualOverride(s) && <span className="rounded-full bg-accent-orange/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent-orange">Manual override</span>}
            {s.origin === 'MANUAL' && <span className="rounded-full bg-accent-cyan/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent-cyan">Manual</span>}
            {s.simulated && <span className="rounded-full bg-accent-purple/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent-purple">Simulating</span>}
            {archived && <span className="rounded-full bg-space-700 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-400">Archived</span>}
          </h1>
          <p className="text-sm text-slate-400">{s.mission} · {s.orbit_type} · NORAD {s.norad_catalog_id || s.norad_id || '—'}</p>
        </div>
        {canManage && !archived && (
          <div className="flex flex-wrap items-center gap-2">
            {s.simulated
              ? <button disabled={busy} onClick={() => act(() => api.stopSimulateSatellite(s.id))} className="flex items-center gap-1.5 rounded-lg border border-space-700 px-3 py-2 text-xs text-slate-300 hover:bg-space-800 disabled:opacity-40"><Square className="h-3.5 w-3.5" /> Stop simulation</button>
              : <button disabled={busy || (s.sim_eligible ?? 1) !== 1} onClick={() => act(() => api.simulateSatellite(s.id))} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-40"><Play className="h-3.5 w-3.5" /> Start simulation</button>}
            {canManageStatus(user?.role) && <button disabled={busy} onClick={() => setManagingStatus(true)} className="flex items-center gap-1.5 rounded-lg border border-space-700 px-3 py-2 text-xs text-slate-300 hover:bg-space-800"><ShieldAlert className="h-3.5 w-3.5" /> Manage status</button>}
            <button disabled={busy} onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border border-space-700 px-3 py-2 text-xs text-slate-300 hover:bg-space-800"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            {canArchive && <button disabled={busy} onClick={() => act(() => api.archiveSatellite(s.id))} className="flex items-center gap-1.5 rounded-lg border border-accent-red/40 px-3 py-2 text-xs text-accent-red hover:bg-accent-red/10"><Archive className="h-3.5 w-3.5" /> Archive</button>}
          </div>
        )}
        {canArchive && archived && (
          <button disabled={busy} onClick={() => act(() => api.reactivateSatellite(s.id))} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs"><RotateCcw className="h-3.5 w-3.5" /> Reactivate</button>
        )}
      </div>

      {noTelemetry && (
        <div className="flex items-center gap-2 rounded-lg border border-space-700 bg-space-800/60 px-4 py-3 text-sm text-slate-300">
          <SatelliteDish className="h-4 w-4 text-accent-cyan" />
          No telemetry available yet. {canManage && !archived ? 'Start simulation to begin generating telemetry, alerts, and (if anomalies persist) an investigation.' : 'This satellite has not received telemetry.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Battery" value={latest ? `${latest.battery_percent}%` : '—'} />
        <Metric label="Temperature" value={latest ? `${latest.temperature_c}°C` : '—'} />
        <Metric label="Power" value={latest ? `${latest.power_consumption_w} W` : '—'} />
        <Metric label="Signal" value={latest ? `${latest.signal_strength_dbm} dBm` : '—'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Telemetry History">
            {noTelemetry
              ? <EmptyState message="No telemetry recorded for this satellite yet." />
              : <TelemetryChart data={telemetry.data ?? []} height={300} />}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Operational Status">
            <dl className="grid grid-cols-2 gap-y-2 text-xs">
              <dt className="text-slate-500">Effective</dt><dd className={`text-right font-semibold ${statusColor(effectiveStatus(s))}`}>{effectiveStatus(s)}</dd>
              <dt className="text-slate-500">Derived</dt><dd className={`text-right ${statusColor(derivedStatus(s))}`}>{derivedStatus(s)}</dd>
              <dt className="text-slate-500">Mode</dt>
              <dd className="text-right text-slate-200">
                {isManualOverride(s)
                  ? <span className="rounded-full bg-accent-orange/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent-orange">Manual override</span>
                  : <span className="text-slate-300">Automatic</span>}
              </dd>
            </dl>
            {isManualOverride(s)
              ? <p className="mt-3 text-[11px] text-slate-500">{s.manual_status_reason ? `Reason: ${s.manual_status_reason}. ` : ''}Overridden by {s.manual_status_updated_by || 'operator'}{s.manual_status_updated_at ? ` · ${timeAgo(s.manual_status_updated_at)}` : ''}. This does not create alerts or investigations.</p>
              : <p className="mt-3 text-[11px] text-slate-500">Status is automatically derived from telemetry, anomaly, and mission-state logic.</p>}
            {canManageStatus(user?.role) && !archived && (
              <button onClick={() => setManagingStatus(true)} className="mt-3 flex items-center gap-1.5 rounded-lg border border-space-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-space-800"><ShieldAlert className="h-3.5 w-3.5" /> Manage status</button>
            )}
          </Panel>
          <Panel title="Health">
            {noTelemetry ? (
              <div className="text-sm text-slate-500">Health unknown — no telemetry yet.</div>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm"><span className="text-slate-400">Score</span><span className="font-mono text-slate-100">{Math.round(s.health_score)}%</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-space-700"><div className={`h-full ${healthBarColor(s.health_score)}`} style={{ width: `${Math.max(2, s.health_score)}%` }} /></div>
              </>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
              <dt className="text-slate-500">Orbit data</dt><dd className="text-right text-slate-200">{orbitUnavailable ? 'unavailable' : (s.orbit_data_state ?? '').replace(/_/g, ' ').toLowerCase()}</dd>
              <dt className="text-slate-500">Telemetry</dt><dd className="text-right text-slate-200">{noTelemetry ? 'none' : s.telemetry_state.toLowerCase()}</dd>
              <dt className="text-slate-500">Altitude</dt><dd className="text-right font-mono text-slate-200">{orbitUnavailable ? '—' : `${s.altitude} km`}</dd>
              <dt className="text-slate-500">Velocity</dt><dd className="text-right font-mono text-slate-200">{orbitUnavailable ? '—' : `${s.velocity} km/s`}</dd>
              <dt className="text-slate-500">Latitude</dt><dd className="text-right font-mono text-slate-200">{orbitUnavailable ? '—' : s.latitude.toFixed(2)}</dd>
              <dt className="text-slate-500">Longitude</dt><dd className="text-right font-mono text-slate-200">{orbitUnavailable ? '—' : s.longitude.toFixed(2)}</dd>
              <dt className="text-slate-500">Origin</dt><dd className="text-right text-slate-200">{s.origin ?? 'SEED'}</dd>
            </dl>
          </Panel>
          <Panel title="Active Alerts" bodyClassName="px-5 py-2">
            {s.active_alerts.length === 0 ? <div className="py-2 text-sm text-slate-500">None</div> : <AlertList alerts={s.active_alerts} compact />}
          </Panel>
          <Panel title="Status History">
            {(history.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-slate-500">No manual status changes recorded.</div>
            ) : (
              <ul className="space-y-2">
                {history.data!.map((e) => (
                  <li key={e.id} className="rounded-lg border border-space-700 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">
                        <span className={statusColor(e.previous_effective_status ?? 'UNKNOWN')}>{e.previous_effective_status ?? '—'}</span>
                        <span className="text-slate-600"> → </span>
                        <span className={statusColor(e.new_effective_status)}>{e.new_effective_status}</span>
                      </span>
                      <span className="rounded-full bg-space-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-300">{e.new_mode}</span>
                    </div>
                    {e.reason && <div className="mt-1 text-slate-400">{e.reason}</div>}
                    <div className="mt-1 text-[10px] text-slate-500">{e.actor}{e.actor_role ? ` · ${e.actor_role}` : ''} · {timeAgo(e.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Investigations">
            {s.investigations.length === 0 ? <div className="text-sm text-slate-500">None</div> : (
              <ul className="space-y-2">
                {s.investigations.map((i) => (
                  <li key={i.id}><Link to={`/investigations/${i.id}`} className="flex items-center justify-between rounded-lg border border-space-700 px-3 py-2 text-sm hover:border-space-500">
                    <span className="font-mono text-xs text-slate-500">INV#{i.id}</span><StatusBadge status={i.status} />
                  </Link></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {editing && <SatelliteFormModal existing={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); sat.refetch(); }} />}
      {managingStatus && <ManageStatusModal sat={s} onClose={() => setManagingStatus(false)} onSaved={() => { sat.refetch(); history.refetch(); }} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-xl text-white">{value}</div>
    </div>
  );
}
