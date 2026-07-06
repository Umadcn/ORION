import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { severityClasses, investigationStatusClasses, humanize } from '../lib/format';
import type { Severity } from '../types';

// ---------- Panel ----------
export function Panel({
  title,
  action,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-header">
          <h2 className="panel-title">{title}</h2>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// ---------- StatCard ----------
export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = 'blue',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: 'blue' | 'green' | 'orange' | 'purple' | 'cyan';
}) {
  const ring: Record<string, string> = {
    blue: 'from-accent-blue/20',
    green: 'from-accent-green/20',
    orange: 'from-accent-orange/20',
    purple: 'from-accent-purple/20',
    cyan: 'from-accent-cyan/20',
  };
  const text: Record<string, string> = {
    blue: 'text-accent-blue',
    green: 'text-accent-green',
    orange: 'text-accent-orange',
    purple: 'text-accent-purple',
    cyan: 'text-accent-cyan',
  };
  return (
    <div className={`panel relative overflow-hidden bg-gradient-to-br ${ring[accent]} to-transparent`}>
      <div className="flex items-start justify-between p-5">
        <div>
          <div className="label">{label}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
          {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
        </div>
        {icon && <div className={`${text[accent]} opacity-80`}>{icon}</div>}
      </div>
    </div>
  );
}

// ---------- Badges ----------
export function SeverityBadge({ severity }: { severity: Severity | string | null }) {
  const c = severityClasses(severity as Severity);
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${c.bg} ${c.text} border ${c.border}`}>
      {severity ?? '—'}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const c = investigationStatusClasses(status);
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${c.bg} ${c.text}`}>
      {humanize(status)}
    </span>
  );
}

export function IntegrationSourceBadge({ mode, fallback }: { mode: string | null; fallback?: boolean }) {
  const offline = mode === 'OFFLINE_FIXTURE';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        offline ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-accent-green/10 text-accent-green'
      }`}
      title={offline ? 'Offline sample data (no live network call)' : 'Live API'}
    >
      {mode === 'OFFLINE_FIXTURE' ? 'OFFLINE FIXTURE' : mode ?? 'INTERNAL'}
      {fallback && <span className="text-accent-orange">· fallback</span>}
    </span>
  );
}

// ---------- States ----------
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-accent-red" />
      <div className="text-sm text-slate-300">{message}</div>
      <div className="text-xs text-slate-500">Is the ORION backend running on 127.0.0.1:8000?</div>
      {onRetry && (
        <button className="btn-ghost mt-1" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-500">
      {icon ?? <Inbox className="h-7 w-7" />}
      <span className="text-sm">{message}</span>
    </div>
  );
}
