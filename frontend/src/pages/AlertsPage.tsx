import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { EmptyState, ErrorState, LoadingState, Panel, SeverityBadge } from '../components/ui';
import { humanize, timeAgo } from '../lib/format';

export default function AlertsPage() {
  const [status, setStatus] = useState('');
  const alerts = usePolling(() => api.alerts(status ? { status } : undefined), 3000, [status]);
  const [busy, setBusy] = useState<number | null>(null);

  const ack = async (id: number) => {
    setBusy(id);
    try { await api.acknowledgeAlert(id); alerts.refetch(); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-sm text-slate-400">Anomaly alerts across the fleet</p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-space-600 bg-space-800 px-3 py-2 text-sm text-slate-200">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>

      <Panel bodyClassName="p-0">
        {alerts.loading ? <LoadingState /> : alerts.error ? <ErrorState message={alerts.error} onRetry={alerts.refetch} /> :
          (alerts.data?.length ?? 0) === 0 ? <div className="p-6"><EmptyState message="No alerts match this filter." /></div> : (
          <table className="w-full text-sm">
            <thead className="border-b border-space-700 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Severity</th><th className="px-5 py-3">Satellite</th><th className="px-5 py-3">Anomaly</th>
                <th className="px-5 py-3">Message</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">When</th><th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-space-700">
              {alerts.data!.map((a) => (
                <tr key={a.id} className="hover:bg-space-800">
                  <td className="px-5 py-3"><SeverityBadge severity={a.severity} /></td>
                  <td className="px-5 py-3 font-semibold text-slate-200">{a.satellite_id}</td>
                  <td className="px-5 py-3 text-slate-300">{humanize(a.anomaly_type)}</td>
                  <td className="max-w-xs truncate px-5 py-3 text-slate-400">{a.message}</td>
                  <td className="px-5 py-3"><span className="text-xs text-slate-400">{humanize(a.status)}</span></td>
                  <td className="px-5 py-3 text-xs text-slate-500">{timeAgo(a.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    {a.investigation_id && <Link to={`/investigations/${a.investigation_id}`} className="mr-3 text-xs text-accent-blue hover:underline">INV#{a.investigation_id}</Link>}
                    {a.status === 'ACTIVE' && (
                      <button className="btn-ghost !px-2 !py-1 text-xs" disabled={busy === a.id} onClick={() => ack(a.id)}><Check className="h-3.5 w-3.5" /> Ack</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
