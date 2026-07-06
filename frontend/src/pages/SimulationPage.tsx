import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, Square, RotateCw, Search, Plus, X, AlertTriangle, Gauge, Radio, Satellite as SatIcon,
  Activity, Loader2, Trash2, ArrowRight, ShieldAlert,
} from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState, Panel } from '../components/ui';
import { TelemetryChart } from '../components/TelemetryChart';
import { humanize, timeAgo } from '../lib/format';
import {
  SIM_SPEEDS, SIM_FIELDS, canControlSimulation, canStart, canPause, canResume, canStop, canInject,
  activeFailures, filterSatellites, fieldLabel, fieldUnit, sessionStatusColor,
} from '../lib/simulation';
import type { FailureCatalogEntry, SimFieldKey, SimSession, Severity, Telemetry } from '../types';

export default function SimulationPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canControl = canControlSimulation(user?.role);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const sats = usePolling(() => api.simSatellites(), 3000);
  const catalog = usePolling(() => api.simFailureCatalog(), 0);

  const selectedSat = (sats.data ?? []).find((s) => s.id === selectedId) ?? null;
  const sessionId = selectedSat?.session_id ?? null;

  const session = usePolling<SimSession | null>(
    () => (sessionId ? api.simSession(sessionId) : Promise.resolve(null)),
    2000,
    [sessionId],
  );
  const telemetry = usePolling(
    () => (sessionId ? api.simTelemetry(sessionId, 60) : Promise.resolve([])),
    2000,
    [sessionId],
  );
  const events = usePolling(
    () => (sessionId ? api.simEvents(sessionId, 60) : Promise.resolve([])),
    3000,
    [sessionId],
  );
  const investigations = usePolling(() => api.investigations(), 3000);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const s = session.data;
  const status = s?.status ?? selectedSat?.session_status ?? null;

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); setToast(`${label} ✓`); sats.refetch(); session.refetch(); events.refetch(); }
    catch (e) { setToast(`${label} failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  const startSimulation = () =>
    act('Start simulation', async () => {
      let sid = sessionId;
      if (!sid) { const created = await api.simCreateSession({ satelliteId: selectedSat!.id }); sid = created.id; }
      await api.simStart(sid!);
      await sats.refetch();
    });

  const activeInv = (investigations.data ?? []).find(
    (i) => i.satellite_id === selectedId && i.status !== 'RESOLVED' && i.status !== 'REJECTED',
  ) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Satellite Simulation Control Center</h1>
          <p className="text-sm text-slate-400">Configure, run, and observe isolated satellite simulations through the complete ORION mission-intelligence pipeline.</p>
        </div>
        <span className="rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-cyan">Telemetry source: Simulated</span>
      </div>

      {toast && <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/10 px-4 py-2 text-sm text-accent-blue">{toast}</div>}
      {!canControl && (
        <div className="flex items-center gap-2 rounded-lg border border-space-700 bg-space-800/60 px-4 py-2 text-xs text-slate-400">
          <ShieldAlert className="h-4 w-4 text-accent-orange" /> You have view-only access. Simulation control requires the Mission Director or System Admin role.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left column: selector + summary + controls + config */}
        <div className="space-y-5 lg:col-span-1">
          <Panel title="Select Satellite">
            {sats.loading ? <LoadingState /> : sats.error ? <ErrorState message={sats.error} onRetry={sats.refetch} /> : (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search id, name, mission…"
                    className="w-full rounded-lg border border-space-700 bg-space-900 py-2 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-accent-blue focus:outline-none" />
                </div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {filterSatellites(sats.data ?? [], query).length === 0 && <EmptyState message="No simulation-eligible satellites." />}
                  {filterSatellites(sats.data ?? [], query).map((sat) => (
                    <button key={sat.id} onClick={() => setSelectedId(sat.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selectedId === sat.id ? 'border-accent-blue bg-accent-blue/10' : 'border-space-700 bg-space-800/40 hover:border-space-500'}`}>
                      <span className="flex items-center gap-2">
                        <SatIcon className="h-3.5 w-3.5 text-accent-cyan" />
                        <span className="font-semibold text-white">{sat.id}</span>
                        {sat.origin === 'MANUAL' && <span className="rounded-full bg-accent-cyan/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-cyan">Manual</span>}
                      </span>
                      <span className={`text-[10px] font-semibold uppercase ${sessionStatusColor(sat.session_status)}`}>{sat.session_status ?? 'no session'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </Panel>

          {selectedSat && (
            <Panel title="Satellite Summary">
              <dl className="grid grid-cols-2 gap-y-2 text-xs">
                <dt className="text-slate-500">Satellite</dt><dd className="text-right font-semibold text-white">{selectedSat.id}</dd>
                <dt className="text-slate-500">Name</dt><dd className="text-right text-slate-200">{selectedSat.name}</dd>
                <dt className="text-slate-500">Mission</dt><dd className="text-right text-slate-200">{selectedSat.mission}</dd>
                <dt className="text-slate-500">Operational status</dt><dd className="text-right text-slate-200">{selectedSat.status}</dd>
                <dt className="text-slate-500">Telemetry source</dt><dd className="text-right text-slate-200">{humanize(selectedSat.data_source_mode)}</dd>
                <dt className="text-slate-500">Simulation status</dt><dd className={`text-right font-semibold ${sessionStatusColor(status)}`}>{status ?? 'none'}</dd>
                <dt className="text-slate-500">Telemetry samples</dt><dd className="text-right font-mono text-slate-200">{selectedSat.telemetry_sample_count}</dd>
                <dt className="text-slate-500">Active alerts</dt><dd className="text-right font-mono text-slate-200">{selectedSat.active_alerts}</dd>
                <dt className="text-slate-500">Open investigations</dt><dd className="text-right font-mono text-slate-200">{selectedSat.open_investigations}</dd>
              </dl>
            </Panel>
          )}

          {selectedSat && canControl && (
            <Panel title="Simulation Controls">
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-success" disabled={busy !== null || status === 'RUNNING'} onClick={startSimulation}><Play className="h-4 w-4" /> {canStart(status) || !status ? 'Start' : 'Running'}</button>
                <button className="btn-ghost" disabled={busy !== null || !canPause(status)} onClick={() => act('Pause', () => api.simPause(sessionId!))}><Pause className="h-4 w-4" /> Pause</button>
                <button className="btn-ghost" disabled={busy !== null || !canResume(status)} onClick={() => act('Resume', () => api.simResume(sessionId!))}><RotateCw className="h-4 w-4" /> Resume</button>
                <button className="btn-danger" disabled={busy !== null || !canStop(status)} onClick={() => act('Stop', () => api.simStop(sessionId!))}><Square className="h-4 w-4" /> Stop</button>
              </div>
              {s && (
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <Gauge className="h-4 w-4 text-slate-500" />
                  <span className="text-slate-500">Speed</span>
                  <div className="flex gap-1">
                    {SIM_SPEEDS.map((sp) => (
                      <button key={sp} disabled={busy !== null} onClick={() => act(`Speed ${sp}x`, () => api.simSetSpeed(sessionId!, sp))}
                        className={`rounded px-2 py-1 text-[11px] font-semibold ${s.simulation_speed === sp ? 'bg-accent-blue text-white' : 'bg-space-800 text-slate-400 hover:bg-space-700'}`}>{sp}x</button>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">Stop ends telemetry generation for this satellite only. It never deletes telemetry history, alerts, investigations, or reports.</p>
            </Panel>
          )}

          {s && canControl && <TelemetryConfig session={s} busy={busy} onApply={(patch, label) => act(label, () => api.simUpdateConfig(sessionId!, patch))} telemetry={telemetry.data ?? []} />}
        </div>

        {/* Middle+right columns */}
        <div className="space-y-5 lg:col-span-2">
          {!selectedSat && <Panel title="Live Telemetry"><EmptyState message="Select a simulation-eligible satellite to begin." /></Panel>}

          {selectedSat && (
            <Panel title={`Live Telemetry — ${selectedSat.id}`} action={s && <span className={`text-xs font-semibold uppercase ${sessionStatusColor(status)}`}>{status}</span>}>
              {!sessionId ? <EmptyState message="No simulation session yet. Configure and start a simulation for this satellite." />
                : telemetry.loading ? <LoadingState />
                : (telemetry.data?.length ?? 0) === 0 ? <EmptyState message={status === 'PAUSED' ? 'Paused — telemetry generation is suspended.' : 'Waiting for the first simulated sample…'} />
                : <TelemetryChart data={telemetry.data ?? []} height={260} />}
            </Panel>
          )}

          {selectedSat && canControl && (
            <FailureCatalogPanel catalog={catalog.data ?? []} busy={busy} disabled={!canInject(status)}
              onInject={(spec) => act(`Inject ${spec.failureType}`, async () => {
                let sid = sessionId;
                if (!sid) { const created = await api.simCreateSession({ satelliteId: selectedSat.id }); sid = created.id; await api.simStart(sid); }
                await api.simInjectFailure(sid!, spec);
                await sats.refetch();
              })} />
          )}

          {s && (
            <Panel title="Active Failures" action={canControl && activeFailures(s).length > 0 && (
              <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy !== null} onClick={() => act('Clear all failures', () => api.simClearFailures(sessionId!))}><Trash2 className="h-3.5 w-3.5" /> Clear all</button>
            )}>
              {activeFailures(s).length === 0 ? <EmptyState message="No active failures." /> : (
                <ul className="space-y-2">
                  {activeFailures(s).map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded-lg border border-accent-orange/30 bg-accent-orange/10 px-3 py-2 text-sm">
                      <div>
                        <span className="flex items-center gap-2 font-semibold text-accent-orange"><AlertTriangle className="h-4 w-4" /> {f.display_name}</span>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {f.severity} · onset {f.onset.toLowerCase()} · {f.duration_ticks ? `${f.remaining_ticks}/${f.duration_ticks} ticks left` : 'until removed'} · affects {f.affected_fields.map(fieldLabel).join(', ')}
                        </div>
                      </div>
                      {canControl && <button className="text-slate-500 hover:text-accent-red" disabled={busy !== null} onClick={() => act(`Remove ${f.failure_type}`, () => api.simRemoveFailure(sessionId!, f.id))}><X className="h-4 w-4" /></button>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {selectedSat && (
            <Panel title="Pipeline Activity" action={activeInv && (
              <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => navigate(`/investigations/${activeInv.id}`)}>Open investigation <ArrowRight className="h-3.5 w-3.5" /></button>
            )}>
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <PipelineStat icon={Radio} label="Telemetry" value={String(selectedSat.telemetry_sample_count)} />
                <PipelineStat icon={AlertTriangle} label="Active alerts" value={String(selectedSat.active_alerts)} />
                <PipelineStat icon={Activity} label="Open investigations" value={String(selectedSat.open_investigations)} />
                <PipelineStat icon={Gauge} label="Ticks" value={String(s?.tick_count ?? 0)} />
              </div>
              <p className="mt-3 text-[11px] text-slate-500">Simulated telemetry flows through the existing deterministic anomaly engine; alerts, investigations, the six-agent pipeline, RCA, evidence and reports are produced by the normal pipeline — never fabricated here.</p>
            </Panel>
          )}

          {selectedSat && (
            <Panel title="Event Log" bodyClassName="p-0">
              {(events.data?.length ?? 0) === 0 ? <div className="p-5"><EmptyState message="No simulation events yet." /></div> : (
                <ul className="max-h-72 divide-y divide-space-700 overflow-y-auto font-mono text-xs">
                  {(events.data ?? []).map((e) => (
                    <li key={e.id} className="flex items-start gap-2 px-4 py-2">
                      <span className="whitespace-nowrap text-slate-600">{timeAgo(e.created_at)}</span>
                      <span className="text-accent-cyan">{e.event_type}</span>
                      <span className="text-slate-300">{e.summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineStat({ icon: Icon, label, value }: { icon: typeof Radio; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-space-700 bg-space-800/40 p-3">
      <div className="flex items-center gap-1.5 text-slate-500"><Icon className="h-3.5 w-3.5" /> {label}</div>
      <div className="mt-1 font-mono text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function TelemetryConfig({ session, busy, onApply, telemetry }: {
  session: SimSession; busy: string | null;
  onApply: (patch: Partial<Record<SimFieldKey, { baseline: number; min: number; max: number; noise: number; drift: number }>>, label: string) => void;
  telemetry: Telemetry[];
}) {
  const latest = telemetry.length ? (telemetry[telemetry.length - 1] as unknown as Record<string, number>) : null;
  return (
    <Panel title="Telemetry Configuration">
      <div className="space-y-3">
        {SIM_FIELDS.map((f) => {
          const cfg = session.telemetry_profile[f.key];
          const emitted = latest ? Number(latest[f.key]) : null;
          const affected = session.failures.some((x) => x.state === 'ACTIVE' && x.affected_fields.includes(f.key));
          return <FieldRow key={f.key} fieldKey={f.key} label={f.label} unit={f.unit} cfg={cfg} emitted={emitted} affected={affected} busy={busy} onApply={onApply} />;
        })}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">Baseline = target value · Final emitted = generated value after any failure effect. Changes affect future telemetry only; history is never rewritten.</p>
    </Panel>
  );
}

function FieldRow({ fieldKey, label, unit, cfg, emitted, affected, busy, onApply }: {
  fieldKey: SimFieldKey; label: string; unit: string;
  cfg: { baseline: number; min: number; max: number; noise: number; drift: number };
  emitted: number | null; affected: boolean; busy: string | null;
  onApply: (patch: Partial<Record<SimFieldKey, { baseline: number; min: number; max: number; noise: number; drift: number }>>, label: string) => void;
}) {
  const [local, setLocal] = useState(cfg);
  useEffect(() => { setLocal(cfg); }, [cfg.baseline, cfg.min, cfg.max, cfg.noise, cfg.drift]); // eslint-disable-line react-hooks/exhaustive-deps
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <div className="rounded-lg border border-space-700 bg-space-900/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200">{label} <span className="text-slate-500">({unit})</span></span>
        <span className="text-[11px] text-slate-400">emitted <b className={affected ? 'text-accent-orange' : 'text-slate-200'}>{emitted ?? '—'}</b></span>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {(['baseline', 'min', 'max', 'noise', 'drift'] as const).map((k) => (
          <label key={k} className="flex flex-col text-[9px] uppercase text-slate-500">
            {k}
            <input type="number" value={local[k]} onChange={(e) => setLocal({ ...local, [k]: num(e.target.value) })}
              className="mt-0.5 w-full rounded border border-space-700 bg-space-900 px-1 py-0.5 text-[11px] text-slate-200 focus:border-accent-blue focus:outline-none" />
          </label>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn-ghost !px-2 !py-1 text-[11px]" disabled={busy !== null} onClick={() => onApply({ [fieldKey]: local }, `Apply ${label}`)}>Apply</button>
        <button className="text-[11px] text-slate-500 hover:text-slate-300" disabled={busy !== null}
          onClick={() => onApply({ [fieldKey]: { ...local, drift: 0 } }, `Restore ${label} baseline`)}>Restore baseline</button>
      </div>
    </div>
  );
}

function FailureCatalogPanel({ catalog, busy, disabled, onInject }: {
  catalog: FailureCatalogEntry[]; busy: string | null; disabled: boolean;
  onInject: (spec: { failureType: string; severity: string; onset: string; recovery: string; durationTicks: number | null }) => void;
}) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return catalog.filter((c) => !q || c.displayName.toLowerCase().includes(q) || c.failureType.toLowerCase().includes(q));
  }, [catalog, filter]);
  return (
    <Panel title="Failure Catalog" action={
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter failures…"
        className="rounded-lg border border-space-700 bg-space-900 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-accent-blue focus:outline-none" />
    }>
      {catalog.length === 0 ? <EmptyState message="Failure catalog unavailable." /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shown.map((c) => <FailureCard key={c.failureType} def={c} busy={busy} disabled={disabled} onInject={onInject} />)}
        </div>
      )}
    </Panel>
  );
}

function FailureCard({ def, busy, disabled, onInject }: {
  def: FailureCatalogEntry; busy: string | null; disabled: boolean;
  onInject: (spec: { failureType: string; severity: string; onset: string; recovery: string; durationTicks: number | null }) => void;
}) {
  const [severity, setSeverity] = useState<Severity>(def.defaultSeverity);
  const [onset, setOnset] = useState('IMMEDIATE');
  const [recovery, setRecovery] = useState('IMMEDIATE');
  const [duration, setDuration] = useState('');
  return (
    <div className="rounded-lg border border-space-700 bg-space-800/40 p-3">
      <div className="font-semibold text-white">{def.displayName}</div>
      <p className="mt-1 text-[11px] text-slate-400">{def.description}</p>
      <div className="mt-2 flex flex-wrap gap-1 text-[9px]">
        {def.affectedTelemetryFields.map((f) => <span key={f} className="rounded bg-space-700 px-1.5 py-0.5 uppercase text-slate-300">{fieldLabel(f as SimFieldKey)}</span>)}
        {def.expectedAlertTypes.map((a) => <span key={a} className="rounded bg-accent-blue/15 px-1.5 py-0.5 uppercase text-accent-blue">{a}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
        <label className="flex flex-col text-slate-500">Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="mt-0.5 rounded border border-space-700 bg-space-900 px-1 py-0.5 text-[11px] text-slate-200">
            {def.supportedSeverityLevels.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-slate-500">Onset
          <select value={onset} onChange={(e) => setOnset(e.target.value)} disabled={!def.supportsGradualOnset} className="mt-0.5 rounded border border-space-700 bg-space-900 px-1 py-0.5 text-[11px] text-slate-200">
            <option value="IMMEDIATE">Immediate</option><option value="GRADUAL">Gradual</option>
          </select>
        </label>
        <label className="flex flex-col text-slate-500">Recovery
          <select value={recovery} onChange={(e) => setRecovery(e.target.value)} className="mt-0.5 rounded border border-space-700 bg-space-900 px-1 py-0.5 text-[11px] text-slate-200">
            <option value="IMMEDIATE">Immediate</option><option value="LINEAR">Linear</option><option value="GRADUAL">Gradual</option>
          </select>
        </label>
        <label className="flex flex-col text-slate-500">Duration (ticks)
          <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} disabled={!def.supportsDuration} placeholder="∞"
            className="mt-0.5 rounded border border-space-700 bg-space-900 px-1 py-0.5 text-[11px] text-slate-200" />
        </label>
      </div>
      <button className="btn-primary mt-2 w-full !py-1.5 text-xs" disabled={busy !== null || disabled}
        onClick={() => onInject({ failureType: def.failureType, severity, onset, recovery, durationTicks: duration === '' ? null : Number(duration) })}>
        {busy === `Inject ${def.failureType}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Inject failure
      </button>
    </div>
  );
}
