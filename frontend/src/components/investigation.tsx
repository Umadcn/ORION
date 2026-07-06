import { useState } from 'react';
import { ChevronDown, ChevronRight, Crown, Minus, Plus, ShieldCheck } from 'lucide-react';
import type { AgentExecution, Evidence, ScoringEntry } from '../types';
import { agentStatusColor, humanize, timeAgo } from '../lib/format';
import { EmptyState, IntegrationSourceBadge } from './ui';

// ---------- Hypothesis Evaluation ----------
export function HypothesisEvaluation({
  entries,
  winner,
}: {
  entries: ScoringEntry[];
  winner: string | null;
}) {
  if (!entries || entries.length === 0) return <EmptyState message="No hypotheses evaluated yet." />;
  return (
    <div className="space-y-3">
      {entries.map((e, idx) => {
        const isWinner = e.root_cause === winner || (winner === null && idx === 0);
        const supporting = e.contributions.filter((c) => c.weight > 0);
        const contradicting = e.contributions.filter((c) => c.weight < 0);
        return (
          <div
            key={e.root_cause}
            className={`rounded-lg border p-3.5 ${
              isWinner ? 'border-accent-blue/50 bg-accent-blue/5' : 'border-space-700 bg-space-800/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-space-900 text-[11px] font-bold text-slate-400">
                  {idx + 1}
                </span>
                <span className={`text-sm font-semibold ${isWinner ? 'text-white' : 'text-slate-300'}`}>
                  {humanize(e.root_cause)}
                </span>
                {isWinner && (
                  <span className="inline-flex items-center gap-1 rounded bg-accent-blue/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-blue">
                    <Crown className="h-3 w-3" /> Selected
                  </span>
                )}
              </div>
              <span className="font-mono text-sm text-slate-200">{Math.round(e.normalized * 100)}%</span>
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded-full bg-space-700">
              <div
                className={`h-full ${isWinner ? 'bg-accent-blue' : 'bg-space-500'}`}
                style={{ width: `${Math.max(2, e.normalized * 100)}%` }}
              />
            </div>

            {(supporting.length > 0 || contradicting.length > 0) && (
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent-green">
                    <Plus className="h-3 w-3" /> Supporting
                  </div>
                  {supporting.length === 0 ? (
                    <div className="text-[11px] text-slate-600">—</div>
                  ) : (
                    <ul className="space-y-0.5">
                      {supporting.map((c, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-[11px] text-slate-400">
                          <span className="min-w-0 flex-1">{c.factor}</span>
                          <span className="font-mono text-accent-green">+{c.weight}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent-red">
                    <Minus className="h-3 w-3" /> Contradicting
                  </div>
                  {contradicting.length === 0 ? (
                    <div className="text-[11px] text-slate-600">—</div>
                  ) : (
                    <ul className="space-y-0.5">
                      {contradicting.map((c, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-[11px] text-slate-400">
                          <span className="min-w-0 flex-1">{c.factor}</span>
                          <span className="font-mono text-accent-red">{c.weight}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Evidence Provenance Ledger ----------
export function EvidenceLedger({ evidence }: { evidence: Evidence[] }) {
  if (!evidence || evidence.length === 0) return <EmptyState message="No evidence collected yet." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-space-700 uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Source Type</th>
            <th className="px-3 py-2">Collected By</th>
            <th className="px-3 py-2">Provenance</th>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Summary</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-space-700">
          {evidence.map((e) => (
            <tr key={e.id} className="align-top hover:bg-space-800/50">
              <td className="px-3 py-2 font-mono text-slate-500">EV{e.id}</td>
              <td className="px-3 py-2">
                <span className="rounded bg-space-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                  {humanize(e.source_type)}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-300">{e.source_name}</td>
              <td className="px-3 py-2">
                {e.mode ? (
                  <IntegrationSourceBadge mode={e.mode} fallback={e.fallback_used} />
                ) : (
                  <span className="text-[10px] text-slate-600">internal</span>
                )}
                {e.cached && <span className="ml-1 text-[10px] text-slate-500">· cached</span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">{timeAgo(e.timestamp)}</td>
              <td className="px-3 py-2 text-slate-400">{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5 text-accent-green" />
        Every external datum carries source, mode, and fallback metadata for full auditability.
      </div>
    </div>
  );
}

// ---------- Expandable Agent Timeline ----------
export function ExpandableAgentTimeline({ executions }: { executions: AgentExecution[] }) {
  if (executions.length === 0) return <EmptyState message="No agent executions recorded yet." />;
  return (
    <ol className="space-y-2">
      {executions.map((e, idx) => (
        <AgentRow key={e.id} exec={e} order={idx + 1} />
      ))}
    </ol>
  );
}

function AgentRow({ exec, order }: { exec: AgentExecution; order: number }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(exec.input_summary || exec.output_summary || exec.error_message);
  return (
    <li className="rounded-lg border border-space-700 bg-space-800/40">
      <button
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
        onClick={() => hasDetail && setOpen((o) => !o)}
      >
        <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-space-900 text-[11px] font-bold text-slate-400">
          {order}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{exec.agent_name}</span>
            <span className={`text-[10px] font-semibold uppercase ${agentStatusColor(exec.status)}`}>
              {humanize(exec.status)}
            </span>
          </div>
          {!open && exec.output_summary && (
            <div className="truncate text-xs text-slate-500">{exec.output_summary}</div>
          )}
        </div>
        <span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
          {exec.duration_ms != null ? `${exec.duration_ms}ms` : ''}
        </span>
        {hasDetail && (open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />)}
      </button>
      {open && hasDetail && (
        <div className="space-y-1.5 border-t border-space-700 px-3.5 py-2.5 text-xs">
          {exec.input_summary && (
            <div><span className="text-slate-500">Input:</span> <span className="text-slate-300">{exec.input_summary}</span></div>
          )}
          {exec.output_summary && (
            <div><span className="text-slate-500">Output:</span> <span className="text-slate-300">{exec.output_summary}</span></div>
          )}
          {exec.error_message && (
            <div><span className="text-slate-500">Error:</span> <span className="text-accent-red">{exec.error_message}</span></div>
          )}
          <div className="text-[11px] text-slate-600">
            {exec.started_at && <>started {timeAgo(exec.started_at)}</>}
            {exec.completed_at && <> · completed {timeAgo(exec.completed_at)}</>}
          </div>
        </div>
      )}
    </li>
  );
}
