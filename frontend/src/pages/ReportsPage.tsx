import { Link } from 'react-router-dom';
import { FileText, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { EmptyState, ErrorState, LoadingState, Panel, SeverityBadge, StatusBadge } from '../components/ui';
import { humanize, timeAgo } from '../lib/format';

// Two-line clamp for Root Cause — bounds row height without hiding data
// (full value stays in the `title` tooltip). Framework-independent so it does
// not depend on the Tailwind line-clamp plugin being enabled.
const CLAMP_2: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  wordBreak: 'normal',
  lineHeight: 1.35,
};

export default function ReportsPage() {
  const reports = usePolling(() => api.reports(), 5000);
  const rows = reports.data ?? [];

  return (
    <div className="w-full min-w-0 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Report Archive</h1>
        <p className="text-sm text-slate-400">Audit-ready investigation reports — persisted and retrievable after simulation reset</p>
      </div>

      <Panel bodyClassName="p-0" className="overflow-hidden">
        {reports.loading ? <LoadingState /> : reports.error ? <ErrorState message={reports.error} onRetry={reports.refetch} /> :
          rows.length === 0 ? <div className="p-6"><EmptyState message="No reports yet. Resolve an investigation and generate its report." /></div> : (
          <>
            {/* Desktop / laptop table (>= lg). table-fixed + colgroup keeps every
                column bounded so the table never exceeds the content width and
                headers share the cells' exact geometry. */}
            <table className="hidden w-full table-fixed text-left text-sm lg:table">
              <colgroup>
                <col style={{ width: '7%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead className="border-b border-space-700 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3 align-middle font-semibold">Report</th>
                  <th className="px-3 py-3 align-middle font-semibold">Investigation</th>
                  <th className="px-3 py-3 align-middle font-semibold">Satellite</th>
                  <th className="px-3 py-3 align-middle font-semibold">Root Cause</th>
                  <th className="px-3 py-3 align-middle font-semibold">Confidence</th>
                  <th className="px-3 py-3 align-middle font-semibold">Severity</th>
                  <th className="px-3 py-3 align-middle font-semibold">Status</th>
                  <th className="px-3 py-3 align-middle font-semibold">Generated</th>
                  <th className="px-3 py-3 align-middle font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-space-700">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-space-800">
                    <td className="px-3 py-3 align-middle font-mono text-xs text-slate-400">RPT#{r.id}</td>
                    <td className="px-3 py-3 align-middle">
                      <Link to={`/investigations/${r.investigation_id}`} className="font-mono text-xs text-accent-blue hover:underline">INV#{r.investigation_id}</Link>
                    </td>
                    <td className="px-3 py-3 align-middle font-semibold text-slate-200">
                      <span className="block truncate" title={r.satellite_id ?? undefined}>{r.satellite_id ?? '—'}</span>
                    </td>
                    <td className="px-3 py-3 align-middle text-slate-300">
                      {r.root_cause
                        ? <span style={CLAMP_2} title={humanize(r.root_cause)}>{humanize(r.root_cause)}</span>
                        : '—'}
                    </td>
                    <td className="px-3 py-3 align-middle font-mono text-slate-300">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                    <td className="px-3 py-3 align-middle">{r.severity ? <SeverityBadge severity={r.severity} /> : '—'}</td>
                    <td className="px-3 py-3 align-middle">{r.investigation_status ? <StatusBadge status={r.investigation_status} /> : '—'}</td>
                    <td className="px-3 py-3 align-middle text-xs text-slate-500"><span className="block truncate" title={r.created_at}>{timeAgo(r.created_at)}</span></td>
                    <td className="px-3 py-3 align-middle">
                      <Link to={`/reports/${r.id}`} className="btn-ghost inline-flex whitespace-nowrap !px-3 !py-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Small screens / tablets (< lg): responsive cards — no horizontal
                scroll, Open always visible, no column compression. */}
            <ul className="divide-y divide-space-700 lg:hidden">
              {rows.map((r) => (
                <li key={r.id} className="p-4 hover:bg-space-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-400">RPT#{r.id}</span>
                        <Link to={`/investigations/${r.investigation_id}`} className="font-mono text-xs text-accent-blue hover:underline">INV#{r.investigation_id}</Link>
                        <span className="truncate font-semibold text-slate-200" title={r.satellite_id ?? undefined}>{r.satellite_id ?? '—'}</span>
                      </div>
                      {r.root_cause && <div className="mt-1.5 text-sm text-slate-300" style={{ overflowWrap: 'anywhere', lineHeight: 1.35 }}>{humanize(r.root_cause)}</div>}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {r.severity && <SeverityBadge severity={r.severity} />}
                        {r.investigation_status && <StatusBadge status={r.investigation_status} />}
                        {r.confidence != null && <span className="font-mono text-slate-400">{Math.round(r.confidence * 100)}%</span>}
                        <span>· {timeAgo(r.created_at)}</span>
                      </div>
                    </div>
                    <Link to={`/reports/${r.id}`} className="btn-ghost inline-flex shrink-0 whitespace-nowrap !px-3 !py-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> Open</Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5 text-accent-green" />
        Reports persist in SQLite independently of simulation state — resetting the demo never deletes them.
      </div>
    </div>
  );
}
