import { Link } from 'react-router-dom';
import { Cpu, Sparkles, TrendingUp } from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { EmptyState, ErrorState, LoadingState, Panel, SeverityBadge, StatCard, StatusBadge } from '../components/ui';
import { ConfidenceMeter } from '../components/domain';
import { humanize } from '../lib/format';

export default function AiInsightsPage() {
  const insights = usePolling(() => api.insights(), 4000);
  const investigations = usePolling(() => api.investigations(), 4000);

  if (insights.loading) return <LoadingState label="Loading AI insights…" />;
  if (insights.error) return <ErrorState message={insights.error} onRetry={insights.refetch} />;

  const data = insights.data ?? [];
  const analyzed = (investigations.data ?? []).filter((i) => i.root_cause).length;
  const avgConf = data.length ? Math.round((data.reduce((a, i) => a + i.confidence, 0) / data.length) * 100) : 0;
  const critical = data.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Sparkles className="h-6 w-6 text-accent-purple" /> AI Mission Insights</h1>
        <p className="text-sm text-slate-400">Findings from ORION's deterministic multi-agent investigation pipeline</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Investigations Analyzed" value={analyzed} icon={<Cpu className="h-6 w-6" />} accent="purple" />
        <StatCard label="Avg. Confidence" value={`${avgConf}%`} icon={<TrendingUp className="h-6 w-6" />} accent="green" />
        <StatCard label="High / Critical" value={critical} icon={<Sparkles className="h-6 w-6" />} accent="orange" />
      </div>

      {data.length === 0 ? (
        <Panel><EmptyState message="No AI insights yet. Run an investigation on the Simulation page." icon={<Cpu className="h-7 w-7" />} /></Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.map((i) => (
            <Link key={i.investigation_id} to={`/investigations/${i.investigation_id}`} className="panel block p-5 transition-colors hover:border-space-500">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-mono text-slate-500">INV#{i.investigation_id} · {i.satellite_id}</div>
                  <div className="mt-0.5 text-lg font-bold text-white">{humanize(i.root_cause)}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <SeverityBadge severity={i.severity} />
                  <StatusBadge status={i.status} />
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-400">{i.explanation}</p>
              <div className="mt-3"><ConfidenceMeter confidence={i.confidence} /></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
