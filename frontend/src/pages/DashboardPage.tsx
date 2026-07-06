import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Cpu, FileText, HeartPulse, Play, Radio, Satellite, Search,
  Settings as SettingsIcon, ShieldCheck, Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { EmptyState, ErrorState, IntegrationSourceBadge, LoadingState, Panel, StatCard } from '../components/ui';
import { AlertList } from '../components/domain';
import { InvestigationPipeline } from '../components/InvestigationPipeline';
import { InteractiveEarthGlobe } from '../components/orbit3d/InteractiveEarthGlobe';
import { SatelliteHealthDonut } from '../components/SatelliteHealthDonut';
import { ActivityFeed } from '../components/ActivityFeed';
import { TelemetryChart } from '../components/TelemetryChart';
import { clockUTC, dateUTC, humanize, welcomeName } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { useEffect, useState } from 'react';
import type { Investigation } from '../types';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [clock, setClock] = useState(clockUTC());
  useEffect(() => { const t = setInterval(() => setClock(clockUTC()), 1000); return () => clearInterval(t); }, []);

  const summary = usePolling(() => api.dashboardSummary(), 3000);
  const sim = usePolling(() => api.simulationStatus(), 3000);
  const investigations = usePolling(() => api.dashboardInvestigations(), 3000);
  const agents = usePolling(() => api.agents(), 0);
  const alerts = usePolling(() => api.recentAlerts(), 3000);
  const reports = usePolling(() => api.reports(), 8000);
  const insights = usePolling(() => api.insights(), 4000);
  const telemetry = usePolling(() => api.dashboardTelemetry(undefined, 60), 3000);
  const weather = usePolling(() => api.spaceWeather(), 15000);

  const invList = investigations.data ?? [];
  const target: Investigation | null =
    invList.find((i) => i.status !== 'RESOLVED' && i.status !== 'REJECTED') ?? invList[0] ?? null;
  const targetDetail = usePolling(() => (target ? api.investigation(target.id) : Promise.resolve(null)), 3000, [target?.id ?? 0]);

  if (summary.loading) return <LoadingState label="Loading mission control…" />;
  if (summary.error || !summary.data) return <ErrorState message={summary.error ?? 'No data'} onRetry={summary.refetch} />;

  const s = summary.data;
  const criticalAlerts = (alerts.data ?? []).filter((a) => a.status === 'ACTIVE' && (a.severity === 'HIGH' || a.severity === 'CRITICAL')).length;
  const running = sim.data?.running ?? false;
  const cadence = sim.data ? `${sim.data.active_session_count} active session${sim.data.active_session_count === 1 ? '' : 's'}` : '';
  const topInsight = (insights.data ?? [])[0];

  return (
    <div className="space-y-5">
      {/* Welcome panel */}
      <div className="panel flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-accent-blue/10 via-space-850 to-space-850 p-5">
        <div>
          <h1 className="text-xl font-bold text-white">Welcome back{welcomeName(user) ? `, ${welcomeName(user)}` : ''} 👋</h1>
          <p className="text-sm text-slate-400">Real-time overview of all simulated space missions and assets.</p>
        </div>
        <div className="text-right">
          <div className="label">Mission Time (UTC)</div>
          <div className="font-mono text-2xl font-bold text-accent-cyan">{clock}</div>
          <div className="text-xs text-slate-500">{dateUTC()}</div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Active Satellites" value={s.total_satellites} sub={`${s.healthy_satellites} healthy`} icon={<Satellite className="h-6 w-6" />} accent="blue" />
        <StatCard label="Active Investigations" value={s.active_investigations} sub={<Link to="/investigations" className="hover:underline">View all</Link>} icon={<Search className="h-6 w-6" />} accent="purple" />
        <StatCard label="System Health" value={s.system_health === 'OPERATIONAL' ? 'OK' : 'DEGRADED'} sub={`${s.healthy_percent}% fleet healthy`} icon={<HeartPulse className="h-6 w-6" />} accent={s.system_health === 'OPERATIONAL' ? 'green' : 'orange'} />
        <StatCard label="Critical Alerts" value={criticalAlerts} sub={<Link to="/alerts" className="hover:underline">{s.active_alerts} active total</Link>} icon={<AlertTriangle className="h-6 w-6" />} accent="orange" />
        <StatCard label="Telemetry Feed" value={running ? 'LIVE' : 'IDLE'} sub={running ? cadence : 'simulation stopped'} icon={<Radio className="h-6 w-6" />} accent="cyan" />
      </div>

      {/* Orbit map + health/weather */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Live Orbit Map" className="xl:col-span-2" action={<Link to="/orbit" className="text-xs text-accent-blue hover:underline">Expand</Link>} bodyClassName="p-0">
          <InteractiveEarthGlobe satellites={s.satellites} mode="compact" height={380} />
        </Panel>
        <div className="space-y-5">
          <Panel title="Satellite Health Overview"><SatelliteHealthDonut satellites={s.satellites} /></Panel>
          <Panel title="Space Weather">
            {weather.data ? (
              <div>
                <div className="flex items-end justify-between">
                  <div><div className="label">Kp Index</div><div className="text-3xl font-bold text-accent-green">{weather.data.kp_index}</div></div>
                  <span className="rounded bg-accent-green/15 px-2 py-1 text-xs font-semibold text-accent-green">{weather.data.label}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">{weather.data.commentary}</p>
                <div className="mt-2"><IntegrationSourceBadge mode={weather.data.mode} /></div>
              </div>
            ) : <LoadingState />}
          </Panel>
        </div>
      </div>

      {/* Hero: multi-agent pipeline */}
      <InvestigationPipeline
        agents={agents.data ?? []}
        executions={targetDetail.data?.agent_executions ?? []}
        investigation={targetDetail.data ?? (target && target.status !== 'RESOLVED' && target.status !== 'REJECTED' ? target : null)}
      />

      {/* Telemetry + activity */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title={`Telemetry Stream ${telemetry.data ? `· ${telemetry.data.satellite_id}` : ''}`} className="xl:col-span-2"
          action={<span className="flex items-center gap-1.5 text-xs text-slate-500">{running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-green" />}<Link to="/telemetry" className="text-accent-blue hover:underline">Open</Link></span>}>
          {telemetry.loading ? <LoadingState /> : <TelemetryChart data={telemetry.data?.samples ?? []} height={260} />}
        </Panel>
        <Panel title="Recent Activity" action={<Link to="/investigations" className="text-xs text-accent-blue hover:underline">View All</Link>}>
          <ActivityFeed investigations={invList} alerts={alerts.data ?? []} reports={reports.data ?? []} />
        </Panel>
      </div>

      {/* Insights + alerts + quick actions */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent-purple" /> AI Mission Insights</span>} action={<Link to="/ai-insights" className="text-xs text-accent-blue hover:underline">View All</Link>}>
          {!topInsight ? <EmptyState message="No AI insights yet." icon={<Cpu className="h-7 w-7" />} /> : (
            <div>
              <div className="text-sm font-semibold text-white">{topInsight.satellite_id} · {humanize(topInsight.root_cause)}</div>
              <p className="mt-1.5 text-xs text-slate-400">{topInsight.explanation}</p>
              <div className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-500">Confidence</span><span className="font-mono text-slate-200">{Math.round(topInsight.confidence * 100)}%</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-space-700"><div className="h-full bg-accent-green" style={{ width: `${topInsight.confidence * 100}%` }} /></div>
              <Link to={`/investigations/${topInsight.investigation_id}`} className="btn-ghost mt-4 w-full"><Search className="h-4 w-4" /> Open Command Center</Link>
            </div>
          )}
        </Panel>
        <Panel title="Recent Alerts" action={<Link to="/alerts" className="text-xs text-accent-blue hover:underline">View All</Link>} bodyClassName="px-5 py-2">
          {alerts.loading ? <LoadingState /> : <AlertList alerts={alerts.data ?? []} compact />}
        </Panel>
        <Panel title="Quick Actions">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => navigate('/simulation')} className="btn-ghost flex-col !items-start gap-1 p-3 text-left"><Play className="h-5 w-5 text-accent-blue" /><span className="text-sm font-semibold">Run Simulation</span></button>
            <button onClick={() => navigate('/reports')} className="btn-ghost flex-col !items-start gap-1 p-3 text-left"><FileText className="h-5 w-5 text-accent-green" /><span className="text-sm font-semibold">Generate Report</span></button>
            <button onClick={() => navigate('/investigations')} className="btn-ghost flex-col !items-start gap-1 p-3 text-left"><Search className="h-5 w-5 text-accent-purple" /><span className="text-sm font-semibold">Investigations</span></button>
            <button onClick={() => navigate('/settings')} className="btn-ghost flex-col !items-start gap-1 p-3 text-left"><SettingsIcon className="h-5 w-5 text-slate-300" /><span className="text-sm font-semibold">Settings</span></button>
          </div>
        </Panel>
      </div>

      <div className="flex items-center justify-center gap-2 text-[11px] text-slate-600">
        <ShieldCheck className="h-3.5 w-3.5" />
        Simulation / decision-support system — does not command real satellites. External data is offline sample data.
      </div>
    </div>
  );
}
