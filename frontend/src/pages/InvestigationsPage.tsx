import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { EmptyState, ErrorState, LoadingState, Panel } from '../components/ui';
import { InvestigationRow } from '../components/domain';

export default function InvestigationsPage() {
  const investigations = usePolling(() => api.investigations(), 3000);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Investigations</h1>
        <p className="text-sm text-slate-400">Automated multi-agent anomaly investigations</p>
      </div>
      <Panel bodyClassName="p-0">
        {investigations.loading ? <LoadingState /> :
          investigations.error ? <ErrorState message={investigations.error} onRetry={investigations.refetch} /> :
          (investigations.data?.length ?? 0) === 0 ? <div className="p-6"><EmptyState message="No investigations yet. Inject a failure on the Simulation page." /></div> : (
          <div>
            <div className="flex items-center gap-4 border-b border-space-700 px-4 py-2.5 text-[11px] uppercase tracking-wide text-slate-500">
              <div className="w-16">ID</div><div className="w-24">Satellite</div><div className="flex-1">Root Cause</div>
              <div className="w-[74px]">Priority</div><div className="w-16 text-right">Conf.</div><div className="w-40 text-center">Status</div><div className="w-20 text-right">Created</div>
            </div>
            {investigations.data!.map((inv) => <InvestigationRow key={inv.id} inv={inv} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}
