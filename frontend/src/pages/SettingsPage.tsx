import { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { ErrorState, IntegrationSourceBadge, LoadingState, Panel } from '../components/ui';
import type { AdapterStatus, Thresholds } from '../types';

const FIELDS: { key: keyof Thresholds; label: string; hint: string }[] = [
  { key: 'high_temperature_c', label: 'High Temperature (°C)', hint: 'Trigger HIGH_TEMPERATURE above this' },
  { key: 'low_battery_percent', label: 'Low Battery (%)', hint: 'Trigger LOW_BATTERY below this' },
  { key: 'comm_loss_dbm', label: 'Comm Loss (dBm)', hint: 'Trigger COMMUNICATION_LOSS below this' },
  { key: 'abnormal_power_w', label: 'Abnormal Power (W)', hint: 'Trigger ABNORMAL_POWER_CONSUMPTION above this' },
  { key: 'orbit_deviation_km', label: 'Orbit Deviation (km)', hint: 'Trigger ORBIT_DEVIATION beyond this' },
  { key: 'min_persisted_samples', label: 'Persistence (samples)', hint: 'Samples an anomaly must persist' },
];

export default function SettingsPage() {
  const loaded = usePolling(() => api.thresholds(), 0);
  const integrations = usePolling(() => api.integrations(), 0);
  const [form, setForm] = useState<Thresholds | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (loaded.data && !form) setForm(loaded.data.thresholds); }, [loaded.data, form]);

  if (loaded.loading || !form) return <LoadingState />;
  if (loaded.error) return <ErrorState message={loaded.error} onRetry={loaded.refetch} />;

  const save = async () => {
    setBusy(true);
    try { const r = await api.updateThresholds(form); setForm(r.thresholds); setMsg('Thresholds saved ✓'); }
    catch (e) { setMsg(`Save failed: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { const r = await api.resetThresholds(); setForm(r.thresholds); setMsg('Reset to defaults ✓'); }
    finally { setBusy(false); }
  };

  const adapters = integrations.data as AdapterStatus | null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400">Anomaly detection thresholds &amp; integration status</p>
      </div>

      {msg && <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/10 px-4 py-2 text-sm text-accent-blue">{msg}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Anomaly Detection Thresholds" action={
            <div className="flex gap-2">
              <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
              <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy} onClick={save}><Save className="h-3.5 w-3.5" /> Save</button>
            </div>
          }>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
                    type="number"
                    value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-space-600 bg-space-800 px-3 py-2 font-mono text-sm text-slate-100"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">{f.hint}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="Integration Mode">
          <div className="mb-3 rounded-lg border border-accent-cyan/30 bg-accent-cyan/10 p-3 text-xs text-slate-300">
            All external data adapters run in <b className="text-accent-cyan">OFFLINE FIXTURE MODE</b>. No live network calls are made. Live mode is disabled by default.
          </div>
          {adapters ? (
            <ul className="space-y-3">
              {adapters.adapters.map((a) => (
                <li key={a.name} className="rounded-lg border border-space-700 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">{a.name}</span>
                    <IntegrationSourceBadge mode={a.mode} fallback={a.fallback_used} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{a.purpose}</div>
                  <div className="mt-1 truncate text-[11px] text-slate-600">{a.source_url}</div>
                </li>
              ))}
            </ul>
          ) : <LoadingState />}
        </Panel>
      </div>
    </div>
  );
}
