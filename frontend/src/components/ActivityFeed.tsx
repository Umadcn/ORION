import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileText, Search, Sparkles } from 'lucide-react';
import type { Alert, Investigation, ReportSummary } from '../types';
import { humanize, timeAgo } from '../lib/format';
import { EmptyState } from './ui';

interface Event {
  time: string;
  icon: typeof Search;
  color: string;
  title: string;
  entity: string;
  to: string;
}

/**
 * Aggregated operational activity feed built client-side from real
 * investigations, alerts, and reports (no unified events endpoint exists).
 * Sorted by timestamp, most recent first.
 */
export function ActivityFeed({
  investigations,
  alerts,
  reports,
  limit = 8,
}: {
  investigations: Investigation[];
  alerts: Alert[];
  reports: ReportSummary[];
  limit?: number;
}) {
  const events: Event[] = [];

  for (const i of investigations) {
    events.push({ time: i.created_at, icon: Search, color: 'text-accent-purple', title: 'Investigation opened', entity: `INV#${i.id} · ${i.satellite_id}`, to: `/investigations/${i.id}` });
    if (i.resolved_at) events.push({ time: i.resolved_at, icon: CheckCircle2, color: 'text-accent-green', title: 'Investigation resolved', entity: `INV#${i.id} · ${i.root_cause ? humanize(i.root_cause) : i.satellite_id}`, to: `/investigations/${i.id}` });
  }
  for (const a of alerts) {
    events.push({ time: a.created_at, icon: AlertTriangle, color: 'text-accent-orange', title: `${a.severity} alert`, entity: `${a.satellite_id} · ${humanize(a.anomaly_type)}`, to: a.investigation_id ? `/investigations/${a.investigation_id}` : '/alerts' });
  }
  for (const r of reports) {
    events.push({ time: r.created_at, icon: FileText, color: 'text-accent-cyan', title: 'Report generated', entity: `RPT#${r.id} · ${r.satellite_id ?? ''}`, to: `/reports/${r.id}` });
  }

  events.sort((a, b) => b.time.localeCompare(a.time));
  const top = events.slice(0, limit);

  if (top.length === 0) return <EmptyState message="No recent activity." icon={<Sparkles className="h-7 w-7" />} />;

  return (
    <ul className="space-y-1">
      {top.map((e, i) => {
        const Icon = e.icon;
        return (
          <li key={i}>
            <Link to={e.to} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-space-800">
              <span className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-space-800 ${e.color}`}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">{e.title}</div>
                <div className="truncate text-xs text-slate-500">{e.entity}</div>
              </div>
              <span className="whitespace-nowrap text-[11px] text-slate-500">{timeAgo(e.time)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
