import { useState } from 'react';
import { X, ShieldAlert, Info } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { Satellite } from '../types';
import { statusColor } from '../lib/format';
import {
  MANUAL_STATUS_OPTIONS, MAX_REASON_LEN, validateStatusForm, isStatusChange,
  describeStatusChange, toStatusRequest, statusModeOf, effectiveStatus, derivedStatus,
  type StatusFormState,
} from '../lib/satelliteStatus';

/**
 * Manual status control. Lets an authorized operator set a persistent
 * AUTO/HEALTHY/WARNING/ALERT effective status. A manual override changes only
 * the displayed/operational status — it never fabricates telemetry, alerts,
 * investigations, or RCA (stated in the UI). Two-step: edit → confirm.
 */
export function ManageStatusModal({ sat, onClose, onSaved }: { sat: Satellite; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<StatusFormState>({
    mode: statusModeOf(sat),
    status: sat.manual_status ?? '',
    reason: '',
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  const eff = effectiveStatus(sat);
  const der = derivedStatus(sat);
  const errors = validateStatusForm(f);
  const changed = isStatusChange(sat, f);
  const set = <K extends keyof StatusFormState>(k: K, v: StatusFormState[K]) => setF((p) => ({ ...p, [k]: v }));

  async function apply() {
    if (busy) return; // prevent duplicate submission
    setBusy(true); setError(null); setFieldErrors({});
    try {
      const res = await api.setSatelliteStatus(sat.id, toStatusRequest(f));
      setSuccess(
        res.statusMode === 'MANUAL'
          ? `${res.satelliteId} is now MANUAL ${res.effectiveStatus} (derived ${res.derivedStatus}).`
          : `${res.satelliteId} returned to AUTO — status is now ${res.effectiveStatus}.`,
      );
      onSaved();
    } catch (err) {
      setConfirming(false);
      if (err instanceof ApiError) { setError(err.message); if (err.details) setFieldErrors(err.details); }
      else setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-space-700 bg-space-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-space-700 px-5 py-3.5">
          <div className="flex items-center gap-2 text-white"><ShieldAlert className="h-5 w-5 text-accent-cyan" /><span className="font-bold">Manage status · {sat.id}</span></div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">{error}</div>}
          {success && <div className="rounded-lg border border-accent-green/40 bg-accent-green/10 px-3 py-2 text-xs text-accent-green">{success}</div>}

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-space-700 bg-space-800/50 px-4 py-3 text-sm">
            <div><div className="label">Derived status</div><div className={`font-semibold ${statusColor(der)}`}>{der}</div></div>
            <div><div className="label">Effective status</div><div className={`font-semibold ${statusColor(eff)}`}>{eff}</div></div>
          </div>

          {success ? (
            <div className="flex justify-end"><button onClick={onClose} className="btn-primary px-4 py-2 text-sm">Close</button></div>
          ) : confirming ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-accent-orange/40 bg-accent-orange/10 px-4 py-3 text-sm text-slate-200">
                {describeStatusChange(sat.id, eff, f)}
              </div>
              <div className="flex justify-end gap-2">
                <button disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-space-700 px-4 py-2 text-sm text-slate-300 hover:bg-space-800 disabled:opacity-40">Back</button>
                <button disabled={busy} onClick={apply} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">{busy ? 'Applying…' : 'Confirm'}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="label mb-1">Status mode</div>
                <div className="flex gap-2">
                  {(['AUTO', 'MANUAL'] as const).map((m) => (
                    <button key={m} onClick={() => set('mode', m)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${f.mode === m ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan' : 'border-space-700 text-slate-300 hover:bg-space-800'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {f.mode === 'AUTO' ? (
                <div className="flex items-start gap-2 rounded-lg border border-space-700 bg-space-800/50 px-3 py-2 text-xs text-slate-400">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-cyan" />
                  Status is automatically derived from telemetry, anomaly, and mission-state logic.
                </div>
              ) : (
                <>
                  <div>
                    <div className="label mb-1">Status</div>
                    <div className="flex gap-2">
                      {MANUAL_STATUS_OPTIONS.map((s) => (
                        <button key={s} onClick={() => set('status', s)}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${f.status === s ? `border-current ${statusColor(s)} bg-space-800` : 'border-space-700 text-slate-300 hover:bg-space-800'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                    {fieldErrors.status && <div className="mt-1 text-[10px] text-accent-red">{fieldErrors.status}</div>}
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-space-700 bg-space-800/50 px-3 py-2 text-[11px] text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-cyan" />
                    A manual override changes only the effective/operational status. It does not create alerts, investigations, RCA, or telemetry.
                  </div>
                </>
              )}

              <div>
                <div className="label mb-1">Reason {f.mode === 'MANUAL' ? '' : '(optional)'}</div>
                <input value={f.reason} maxLength={MAX_REASON_LEN} onChange={(e) => set('reason', e.target.value)}
                  placeholder={f.mode === 'MANUAL' ? 'e.g. Operator verification test' : 'Return to telemetry-derived status'}
                  className="w-full rounded-lg border border-space-700 bg-space-800 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-accent-cyan focus:outline-none" />
                {(fieldErrors.reason || errors.reason) && <div className="mt-1 text-[10px] text-accent-red">{fieldErrors.reason || errors.reason}</div>}
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="rounded-lg border border-space-700 px-4 py-2 text-sm text-slate-300 hover:bg-space-800">Cancel</button>
                <button disabled={Object.keys(errors).length > 0 || !changed} onClick={() => setConfirming(true)}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-40">Apply status</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
