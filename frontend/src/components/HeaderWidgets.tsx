import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, Bell, CheckCircle2, ChevronDown, Cpu, Gauge, LogOut, Radio, Satellite, Search,
  ShieldCheck, Stethoscope, X,
} from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { humanize, roleLabel, severityClasses, timeAgo, userInitials } from '../lib/format';
import { canAccess } from '../auth/permissions';
import type { AuthUser } from '../types';

/** Notification bell → real recent alerts with unread (ACTIVE) count. */
export function NotificationBell() {
  const navigate = useNavigate();
  const alerts = usePolling(() => api.recentAlerts(), 4000);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));

  const list = alerts.data ?? [];
  const unread = list.filter((a) => a.status === 'ACTIVE').length;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="hdr-icon-btn" title="Alerts" aria-label="Alerts">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-red px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-lg border border-space-600 bg-space-850 shadow-panel">
          <div className="flex items-center justify-between border-b border-space-700 px-4 py-2.5">
            <span className="text-sm font-semibold text-slate-100">Alerts</span>
            <Link to="/alerts" onClick={() => setOpen(false)} className="text-xs text-accent-blue hover:underline">View all</Link>
          </div>
          {list.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-accent-green" /> No alerts.</div>
          ) : (
            <ul className="max-h-80 divide-y divide-space-700 overflow-y-auto">
              {list.map((a) => {
                const c = severityClasses(a.severity);
                return (
                  <li key={a.id}>
                    <button onClick={() => { setOpen(false); navigate(a.investigation_id ? `/investigations/${a.investigation_id}` : '/alerts'); }} className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-space-800">
                      <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${c.bg}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-slate-200"><b>{a.satellite_id}</b> · {humanize(a.anomaly_type)}</div>
                        <div className="text-xs text-slate-500">{a.severity} · {timeAgo(a.created_at)}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Activity indicator → active investigation count, links to Investigations. */
export function ActivityIndicator() {
  const summary = usePolling(() => api.dashboardSummary(), 5000);
  const n = summary.data?.active_investigations ?? 0;
  return (
    <Link to="/investigations" className="hdr-icon-btn" title="Active investigations" aria-label="Active investigations">
      <Activity className="h-5 w-5" />
      {n > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-purple px-1 text-[10px] font-bold text-white">{n}</span>}
    </Link>
  );
}

/** Profile menu bound to the authenticated user. Offers profile, settings
 *  (role-permitting), system diagnostics, and logout. */
export function ProfileMenu({ user, onDiagnostics, onLogout }: { user: AuthUser | null; onDiagnostics: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));

  // Escape closes the popover (outside-click is handled by useOutside).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Initials derive only from the authenticated user (no hardcoded default).
  const initials = userInitials(user?.display_name || user?.username);
  const canSettings = canAccess(user?.role, '/settings');

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen((o) => !o)} className="flex h-10 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-space-700 px-2.5 hover:bg-space-800" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}>
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-accent-blue/20 text-xs font-bold text-accent-blue">{initials}</div>
        <div className="hidden whitespace-nowrap text-left leading-tight sm:block">
          <div className="text-xs font-semibold text-slate-200">{user?.display_name ?? 'Guest'}</div>
          <div className="text-[10px] text-slate-500">{user ? roleLabel(user.role) : ''}</div>
        </div>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-500" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-auto right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-space-600 bg-space-850 shadow-panel"
          style={{ width: 'clamp(280px, 22vw, 340px)', maxWidth: 'calc(100vw - 24px)' }}
        >
          <div className="border-b border-space-700 px-4 py-3">
            <div className="truncate text-sm font-semibold text-slate-100">{user?.display_name ?? 'Guest'}</div>
            <div className="truncate text-[11px] text-slate-500">{user ? `@${user.username} · ${roleLabel(user.role)}` : '—'}</div>
          </div>
          {user && (
            <dl className="grid grid-cols-[minmax(80px,auto)_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-space-700 px-4 py-3 text-xs">
              <dt className="text-slate-500">Username</dt>
              <dd className="truncate text-right font-mono text-slate-200" title={`@${user.username}`}>@{user.username}</dd>
              <dt className="text-slate-500">Role</dt>
              <dd className="truncate text-right text-slate-200" title={roleLabel(user.role)}>{roleLabel(user.role)}</dd>
              <dt className="text-slate-500">User ID</dt>
              <dd className="truncate text-right font-mono text-slate-200" title={user.id}>{user.id}</dd>
            </dl>
          )}
          {canSettings && <Link to="/settings" role="menuitem" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-space-800"><Gauge className="h-4 w-4 text-slate-400" /> Account Settings</Link>}
          <button role="menuitem" onClick={() => { setOpen(false); onDiagnostics(); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-space-800"><Stethoscope className="h-4 w-4 text-accent-cyan" /> System Diagnostics</button>
          <button role="menuitem" onClick={() => { setOpen(false); onLogout(); }} className="flex w-full items-center gap-2 border-t border-space-700 px-4 py-2.5 text-left text-sm text-accent-red hover:bg-space-800"><LogOut className="h-4 w-4" /> Logout</button>
        </div>
      )}
    </div>
  );
}

/** System Diagnostics modal — real health, agent catalog, satellite + telemetry status. */
export function SystemDiagnostics({ open, onClose }: { open: boolean; onClose: () => void }) {
  const health = usePolling(() => api.health(), open ? 5000 : 0, [open]);
  const agents = usePolling(() => api.agents(), open ? 0 : 0, [open]);
  const summary = usePolling(() => api.dashboardSummary(), open ? 5000 : 0, [open]);
  const latest = usePolling(() => api.telemetry(undefined, 5), open ? 5000 : 0, [open]);

  if (!open) return null;
  const freshest = (latest.data ?? []).reduce<string | null>((acc, t) => (!acc || t.timestamp > acc ? t.timestamp : acc), null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel max-h-[85vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2 className="panel-title flex items-center gap-2"><Stethoscope className="h-4 w-4 text-accent-cyan" /> System Diagnostics</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <Diag icon={ShieldCheck} label="Backend API" value={health.data ? `OK · v${(health.data as any).version ?? '1.0.0'}` : health.error ? 'UNREACHABLE' : '…'} good={!!health.data} />
          <Diag icon={Radio} label="Integration Mode" value={health.data?.integration_mode ?? '—'} good />
          <Diag icon={Satellite} label="Satellite Health" value={summary.data ? `${summary.data.healthy_satellites}/${summary.data.total_satellites} healthy · ${summary.data.system_health}` : '…'} good={summary.data?.system_health === 'OPERATIONAL'} />
          <Diag icon={Activity} label="Telemetry Freshness" value={freshest ? `latest ${timeAgo(freshest)}` : 'no samples'} good={!!freshest} />
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Cpu className="h-3.5 w-3.5" /> Agent Catalog ({agents.data?.length ?? 0})</div>
            <ul className="space-y-1">
              {(agents.data ?? []).map((a) => (
                <li key={a.agent_id} className="flex items-center justify-between rounded border border-space-700 px-3 py-1.5 text-xs">
                  <span className="text-slate-300">{a.name}</span>
                  <span className="flex items-center gap-1 text-accent-green"><CheckCircle2 className="h-3.5 w-3.5" /> ready</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[11px] text-slate-500">Simulation running: <b className="text-slate-300">{health.data?.simulation_running ? 'yes' : 'no'}</b>. All external adapters offline (fixture) — no live network calls.</p>
        </div>
      </div>
    </div>
  );
}

function Diag({ icon: Icon, label, value, good }: { icon: typeof Search; label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-space-700 bg-space-800/50 px-3 py-2.5">
      <span className="flex items-center gap-2 text-slate-300"><Icon className="h-4 w-4 text-slate-400" /> {label}</span>
      <span className={`text-xs font-semibold ${good ? 'text-accent-green' : 'text-accent-orange'}`}>{value}</span>
    </div>
  );
}

function useOutside(ref: React.RefObject<HTMLElement>, cb: () => void) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  });
}
