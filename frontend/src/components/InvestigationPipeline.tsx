import { Link } from 'react-router-dom';
import {
  Activity, AlertCircle, ArrowRight, CheckCircle2, ChevronRight, CircleDashed,
  FileText, Loader2, Radar, Satellite, Sigma, XCircle,
} from 'lucide-react';
import type { AgentExecution, Investigation } from '../types';
import { agentStatusColor, humanize } from '../lib/format';

/** Canonical execution order + short role, keyed by backend agent_id. */
const AGENT_META: { id: string; role: string; icon: typeof Activity }[] = [
  { id: 'telemetry-monitoring', role: 'Trends · health · violations', icon: Activity },
  { id: 'anomaly-detection', role: 'Classify · severity', icon: AlertCircle },
  { id: 'space-weather', role: 'NOAA context (offline)', icon: Radar },
  { id: 'orbit-intelligence', role: 'CelesTrak TLE (offline)', icon: Satellite },
  { id: 'root-cause-analysis', role: 'Weighted scoring', icon: Sigma },
  { id: 'report-generation', role: 'Persist report', icon: FileText },
];

type PipeStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FALLBACK_USED';

const STATUS_ICON: Record<PipeStatus, typeof Activity> = {
  QUEUED: CircleDashed,
  RUNNING: Loader2,
  COMPLETED: CheckCircle2,
  FAILED: XCircle,
  FALLBACK_USED: AlertCircle,
};

function nodeClasses(status: PipeStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'border-accent-green/50 bg-accent-green/5';
    case 'FALLBACK_USED':
      return 'border-accent-orange/50 bg-accent-orange/5';
    case 'RUNNING':
      return 'border-accent-blue/60 bg-accent-blue/10 shadow-[0_0_0_1px_rgba(59,130,246,0.3)]';
    case 'FAILED':
      return 'border-accent-red/50 bg-accent-red/5';
    default:
      return 'border-space-600 bg-space-800/50';
  }
}

export function InvestigationPipeline({
  agents,
  executions,
  investigation,
}: {
  agents: { agent_id: string; name: string; description: string }[];
  executions: AgentExecution[];
  investigation: Investigation | null;
}) {
  // Preserve canonical order; fall back to backend catalog order if ids differ.
  const ordered = AGENT_META.filter((m) => agents.some((a) => a.agent_id === m.id));
  const meta = ordered.length === 6 ? ordered : AGENT_META;

  const execById = new Map(executions.map((e) => [e.agent_id, e]));
  const active = !!investigation;
  const analyzing = investigation?.status === 'DETECTED' || investigation?.status === 'ANALYZING';

  const resolve = (agentId: string, idx: number): { status: PipeStatus; exec?: AgentExecution } => {
    const exec = execById.get(agentId);
    if (exec) return { status: exec.status as PipeStatus, exec };
    if (!active) return { status: 'QUEUED' };
    // No execution row yet. If the pipeline is still analyzing, the next
    // un-run agent is RUNNING and the rest QUEUED.
    const priorDone = meta.slice(0, idx).every((m) => execById.has(m.id));
    if (analyzing && priorDone) return { status: 'RUNNING' };
    return { status: 'QUEUED' };
  };

  const catalogName = (id: string) => agents.find((a) => a.agent_id === id)?.name ?? humanize(id);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title flex items-center gap-2">
          <Radar className="h-4 w-4 text-accent-blue" />
          ORION Autonomous Investigation Pipeline
        </h2>
        <div className="flex items-center gap-3 text-xs">
          {active ? (
            <>
              <span className="text-slate-400">
                INV#{investigation!.id} · <span className="text-accent-cyan">{investigation!.satellite_id}</span>
              </span>
              <Link to={`/investigations/${investigation!.id}`} className="flex items-center gap-1 text-accent-blue hover:underline">
                Command Center <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </>
          ) : (
            <span className="text-slate-500">Idle · no active investigation</span>
          )}
        </div>
      </div>

      <div className="p-5">
        {!active && (
          <p className="mb-4 text-xs text-slate-500">
            Six deterministic agents run in sequence when an anomaly triggers an investigation. Inject a failure on the
            Simulation page to watch them execute on real telemetry.
          </p>
        )}

        <div className="flex flex-wrap items-stretch gap-y-3">
          {meta.map((m, idx) => {
            const { status, exec } = resolve(m.id, idx);
            const StatusIcon = STATUS_ICON[status];
            const AgentIcon = m.icon;
            return (
              <div key={m.id} className="flex min-w-[150px] flex-1 items-stretch">
                <div className={`flex w-full flex-col rounded-lg border p-3 transition-colors ${nodeClasses(status)}`}>
                  <div className="flex items-center justify-between">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-space-900 text-[11px] font-bold text-slate-400">
                      {idx + 1}
                    </span>
                    <StatusIcon className={`h-4 w-4 ${agentStatusColor(status)} ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <AgentIcon className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-xs font-semibold leading-tight text-slate-100">
                      {catalogName(m.id).replace(' Agent', '')}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{m.role}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${agentStatusColor(status)}`}>
                      {humanize(status)}
                    </span>
                    {exec?.duration_ms != null && (
                      <span className="font-mono text-[10px] text-slate-500">{exec.duration_ms}ms</span>
                    )}
                  </div>
                  {exec?.output_summary && (
                    <div className="mt-1.5 line-clamp-2 border-t border-space-700 pt-1.5 text-[10px] leading-snug text-slate-400">
                      {exec.output_summary}
                    </div>
                  )}
                  {exec?.error_message && (
                    <div className="mt-1.5 border-t border-space-700 pt-1.5 text-[10px] text-accent-red">{exec.error_message}</div>
                  )}
                </div>
                {idx < meta.length - 1 && (
                  <div className="flex items-center px-1 text-space-500">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {active && investigation!.root_cause && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent-blue/30 bg-accent-blue/5 px-4 py-2.5">
            <div className="text-sm">
              <span className="text-slate-400">Determined root cause:</span>{' '}
              <span className="font-semibold text-white">{humanize(investigation!.root_cause)}</span>
            </div>
            <div className="text-xs text-slate-400">
              Confidence <span className="font-mono text-accent-green">{Math.round((investigation!.confidence ?? 0) * 100)}%</span>
              {' · '}Severity <span className="font-semibold text-accent-orange">{investigation!.severity}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
