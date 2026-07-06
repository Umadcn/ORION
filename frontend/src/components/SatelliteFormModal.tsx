import { useState } from 'react';
import { X, Satellite as SatIcon } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { SatelliteCreateInput } from '../api/client';
import type { Satellite } from '../types';

const ORBIT_TYPES = ['LEO', 'MEO', 'GEO', 'HEO', 'SSO', 'POLAR', 'OTHER', 'UNKNOWN'];

/**
 * Create / edit a satellite. Honest: leaving orbital fields blank persists the
 * satellite with an "orbit data unavailable" state — no fabricated orbit/telemetry.
 * The satellite gains telemetry/alerts/RCA only as it progresses through the
 * pipeline (e.g. after simulation is explicitly started).
 */
export function SatelliteFormModal({ existing, onClose, onSaved }: { existing?: Satellite; onClose: () => void; onSaved: (s: Satellite) => void }) {
  const editing = !!existing;
  const [f, setF] = useState<SatelliteCreateInput>({
    id: existing?.id ?? '',
    name: existing?.name ?? '',
    mission: existing?.mission ?? '',
    description: existing?.description ?? '',
    orbit_type: existing?.orbit_type ?? '',
    norad_catalog_id: existing?.norad_catalog_id ?? '',
    altitude: existing?.altitude || undefined,
    velocity: existing?.velocity || undefined,
    inclination: existing?.inclination ?? undefined,
    latitude: existing?.latitude || undefined,
    longitude: existing?.longitude || undefined,
    launch_date: existing?.launch_date ?? '',
    tle_line1: existing?.tle_line1 ?? '',
    tle_line2: existing?.tle_line2 ?? '',
    sim_eligible: existing ? (existing.sim_eligible ?? 1) === 1 : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof SatelliteCreateInput, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));
  const num = (v: string) => (v === '' ? undefined : Number(v));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setFieldErrors({});
    try {
      const payload: SatelliteCreateInput = { ...f };
      const saved = editing
        ? await api.updateSatellite(existing!.id, payload)
        : await api.createSatellite(payload);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details) setFieldErrors(err.details);
      } else setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-space-700 bg-space-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-space-700 px-5 py-3.5">
          <div className="flex items-center gap-2 text-white"><SatIcon className="h-5 w-5 text-accent-cyan" /><span className="font-bold">{editing ? `Edit ${existing!.id}` : 'Register satellite'}</span></div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5">
          {error && <div className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">{error}</div>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Satellite ID *" err={fieldErrors.id} hint="e.g. SAT-NEW-001">
              <input value={f.id} disabled={editing} onChange={(e) => set('id', e.target.value)} placeholder="SAT-NEW-001" className={inputCls(editing)} />
            </Field>
            <Field label="Display name" err={fieldErrors.name}>
              <input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} className={inputCls()} />
            </Field>
            <Field label="Mission *" err={fieldErrors.mission}>
              <input value={f.mission} onChange={(e) => set('mission', e.target.value)} placeholder="Earth Observation" className={inputCls()} />
            </Field>
            <Field label="Orbit type" err={fieldErrors.orbit_type}>
              <select value={f.orbit_type ?? ''} onChange={(e) => set('orbit_type', e.target.value)} className={inputCls()}>
                <option value="">(unknown)</option>
                {ORBIT_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="NORAD catalog ID" err={fieldErrors.norad_catalog_id} hint="numeric, optional">
              <input value={f.norad_catalog_id ?? ''} onChange={(e) => set('norad_catalog_id', e.target.value)} placeholder="e.g. 25544" className={inputCls()} />
            </Field>
            <Field label="Launch date" err={fieldErrors.launch_date}>
              <input value={f.launch_date ?? ''} onChange={(e) => set('launch_date', e.target.value)} placeholder="2024-01-15" className={inputCls()} />
            </Field>
            <Field label="Altitude (km)" err={fieldErrors.altitude} hint="blank → orbit data unavailable">
              <input type="number" value={f.altitude ?? ''} onChange={(e) => set('altitude', num(e.target.value))} className={inputCls()} />
            </Field>
            <Field label="Velocity (km/s)" err={fieldErrors.velocity}>
              <input type="number" value={f.velocity ?? ''} onChange={(e) => set('velocity', num(e.target.value))} className={inputCls()} />
            </Field>
            <Field label="Inclination (°)" err={fieldErrors.inclination}>
              <input type="number" value={f.inclination ?? ''} onChange={(e) => set('inclination', num(e.target.value))} className={inputCls()} />
            </Field>
            <Field label="Sim eligible">
              <label className="flex items-center gap-2 pt-2 text-sm text-slate-300">
                <input type="checkbox" checked={f.sim_eligible !== false} onChange={(e) => set('sim_eligible', e.target.checked)} /> Allow simulation
              </label>
            </Field>
            <Field label="Latitude" err={fieldErrors.latitude}><input type="number" value={f.latitude ?? ''} onChange={(e) => set('latitude', num(e.target.value))} className={inputCls()} /></Field>
            <Field label="Longitude" err={fieldErrors.longitude}><input type="number" value={f.longitude ?? ''} onChange={(e) => set('longitude', num(e.target.value))} className={inputCls()} /></Field>
          </div>
          <Field label="TLE line 1" err={fieldErrors.tle}><input value={f.tle_line1 ?? ''} onChange={(e) => set('tle_line1', e.target.value)} className={`${inputCls()} font-mono text-xs`} /></Field>
          <Field label="TLE line 2"><input value={f.tle_line2 ?? ''} onChange={(e) => set('tle_line2', e.target.value)} className={`${inputCls()} font-mono text-xs`} /></Field>
          <Field label="Description"><textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={2} className={inputCls()} /></Field>
          <p className="text-[11px] text-slate-500">A new satellite is registered with <span className="text-slate-300">no telemetry, no alerts, and no investigations</span>. Those appear only as it receives real or explicitly-simulated telemetry.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-space-700 px-4 py-2 text-sm text-slate-300 hover:bg-space-800">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">{busy ? 'Saving…' : editing ? 'Save changes' : 'Register satellite'}</button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, hint, err, children }: { label: string; hint?: string; err?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}{hint ? <span className="ml-1 normal-case text-slate-600">· {hint}</span> : null}</label>
      {children}
      {err && <div className="mt-0.5 text-[10px] text-accent-red">{err}</div>}
    </div>
  );
}
function inputCls(disabled = false) {
  return `w-full rounded-lg border border-space-700 bg-space-800 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-accent-cyan focus:outline-none ${disabled ? 'opacity-50' : ''}`;
}
