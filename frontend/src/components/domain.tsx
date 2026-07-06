import { Link } from 'react-router-dom';
import {
  Activity, CheckCircle2, CircleDot, Clock, ExternalLink, Loader2, Satellite as SatIcon,
  ThermometerSun, XCircle, Zap, AlertCircle,
} from 'lucide-react';
import type {
  AgentExecution, Alert, Evidence, Investigation, Recommendation, Satellite, ScoringEntry,
} from '../types';
import {
  agentStatusColor, healthBarColor, humanize, INVESTIGATION_STAGES, investigationStatusClasses,
  severityClasses, statusColor, timeAgo,
} from '../lib/format';
import { SeverityBadge, IntegrationSourceBadge, EmptyState } from './ui';

// ---------- SatelliteHealthCard ----------
export function SatelliteHealthCard({ sat }: { sat: Satellite }) {
  return (
    <Link
      to={`/satellites/${sat.id}`}
      className="panel block p-4 transition-colors hover:border-space-500"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircleDot className={`h-3 w-3 ${statusColor(sat.status)}`} />
          <span className="font-semibold text-white">{sat.name}</span>
        </div>
        <SatIcon className="h-4 w-4 text-slate-500" />
      </div>
      <div className={`mt-3 text-xs font-semibold uppercase tracking-wide ${statusColor(sat.status)}`}>
        {sat.status}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span>Health</span>
        <span className="font-mono text-slate-200">{Math.round(sat.health_score)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-space-700">
        <div className={`h-full ${healthBarColor(sat.health_score)}`} style={{ width: `${Math.max(2, sat.health_score)}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-slate-500">{sat.mission} · {sat.orbit_type}</div>
    </Link>
  );
}

// ---------- AlertList ----------
export function AlertList({ alerts, compact = false }: { alerts: Alert[]; compact?: boolean }) {
  if (alerts.length === 0) return <EmptyState message="No alerts." icon={<CheckCircle2 className="h-7 w-7 text-accent-green" />} />;
  return (
    <ul className="divide-y divide-space-700">
      {alerts.map((a) => {
        const c = severityClasses(a.severity);
        return (
          <li key={a.id} className="flex items-center gap-3 py-2.5">
            <span className={`w-1.5 self-stretch rounded ${c.bg}`} />
            <SeverityBadge severity={a.severity} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-200">
                <span className="font-semibold">{a.satellite_id}:</span> {humanize(a.anomaly_type)}
              </div>
              {!compact && <div className="truncate text-xs text-slate-500">{a.message}</div>}
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap text-[11px] text-slate-500">
              <Clock className="h-3 w-3" />
              {timeAgo(a.created_at)}
              {a.investigation_id && (
                <Link to={`/investigations/${a.investigation_id}`} className="text-accent-blue hover:underline">
                  INV#{a.investigation_id}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- AgentExecutionTimeline ----------
const AGENT_ICON: Record<string, typeof Zap> = {
  COMPLETED: CheckCircle2,
  FALLBACK_USED: AlertCircle,
  FAILED: XCircle,
  RUNNING: Loader2,
  PENDING: CircleDot,
};

export function AgentExecutionTimeline({ executions }: { executions: AgentExecution[] }) {
  if (executions.length === 0) return <EmptyState message="No agent executions recorded yet." />;
  return (
    <ol className="relative space-y-4 pl-6">
      <span className="absolute bottom-2 left-2 top-2 w-px bg-space-600" />
      {executions.map((e) => {
        const Icon = AGENT_ICON[e.status] ?? CircleDot;
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[18px] top-0.5 grid h-4 w-4 place-items-center rounded-full bg-space-850">
              <Icon className={`h-4 w-4 ${agentStatusColor(e.status)} ${e.status === 'RUNNING' ? 'animate-spin' : ''}`} />
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-100">{e.agent_name}</span>
              <span className={`text-[11px] font-semibold uppercase ${agentStatusColor(e.status)}`}>
                {humanize(e.status)}{e.duration_ms != null ? ` · ${e.duration_ms}ms` : ''}
              </span>
            </div>
            {e.output_summary && <div className="mt-0.5 text-xs text-slate-400">{e.output_summary}</div>}
            {e.error_message && <div className="mt-0.5 text-xs text-accent-red">{e.error_message}</div>}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- InvestigationProgress ----------
export function InvestigationProgress({ status }: { status: string }) {
  // REJECTED collapses onto the review stage visually.
  const effective = status === 'REJECTED' ? 'WAITING_FOR_REVIEW' : status;
  const currentIdx = INVESTIGATION_STAGES.indexOf(effective as never);
  return (
    <div className="flex items-center">
      {INVESTIGATION_STAGES.map((stage, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={stage} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`grid h-8 w-8 place-items-center rounded-full border text-xs ${
                  done
                    ? 'border-accent-green bg-accent-green/20 text-accent-green'
                    : active
                    ? 'border-accent-blue bg-accent-blue/20 text-accent-blue'
                    : 'border-space-600 bg-space-800 text-slate-600'
                }`}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`mt-1.5 whitespace-nowrap text-[10px] uppercase tracking-wide ${active ? 'text-accent-blue' : done ? 'text-slate-400' : 'text-slate-600'}`}>
                {humanize(stage)}
              </span>
            </div>
            {i < INVESTIGATION_STAGES.length - 1 && (
              <div className={`mx-1 h-px flex-1 ${done ? 'bg-accent-green/60' : 'bg-space-600'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- ConfidenceMeter ----------
export function ConfidenceMeter({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? 'bg-accent-green' : pct >= 60 ? 'bg-accent-orange' : 'bg-accent-red';
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="label">Confidence</span>
        <span className="font-mono font-semibold text-slate-100">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-space-700">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------- ScoringBreakdown ----------
export function ScoringBreakdown({ entries }: { entries: ScoringEntry[] }) {
  if (!entries || entries.length === 0) return <EmptyState message="No scoring data." />;
  return (
    <div className="space-y-3">
      {entries.map((e, idx) => (
        <div key={e.root_cause}>
          <div className="flex items-center justify-between text-sm">
            <span className={idx === 0 ? 'font-semibold text-white' : 'text-slate-300'}>
              {humanize(e.root_cause)}
            </span>
            <span className="font-mono text-xs text-slate-400">{Math.round(e.normalized * 100)}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-space-700">
            <div
              className={`h-full ${idx === 0 ? 'bg-accent-blue' : 'bg-space-500'}`}
              style={{ width: `${Math.max(2, e.normalized * 100)}%` }}
            />
          </div>
          {idx === 0 && e.contributions.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {e.contributions.map((c, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-[11px] text-slate-500">
                  <span className="min-w-0 flex-1">{c.factor}</span>
                  <span className={`font-mono ${c.weight >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {c.weight >= 0 ? '+' : ''}{c.weight}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- EvidenceCard ----------
const SOURCE_ICON: Record<string, typeof Zap> = {
  TELEMETRY: Activity,
  ANOMALY_RULE: AlertCircle,
  SPACE_WEATHER: ThermometerSun,
  ORBIT_DATA: SatIcon,
  SYSTEM: Zap,
};

export function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const Icon = SOURCE_ICON[evidence.source_type] ?? Zap;
  return (
    <div className="rounded-lg border border-space-700 bg-space-800/60 p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <Icon className="h-4 w-4 text-accent-cyan" />
          {humanize(evidence.source_type)}
          <span className="text-slate-600">·</span>
          <span className="font-normal text-slate-500">{evidence.source_name}</span>
        </div>
        <div className="flex items-center gap-2">
          {evidence.mode && <IntegrationSourceBadge mode={evidence.mode} fallback={evidence.fallback_used} />}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              evidence.supports_root_cause ? 'bg-accent-green/10 text-accent-green' : 'bg-slate-500/10 text-slate-400'
            }`}
          >
            {evidence.supports_root_cause ? 'SUPPORTS' : 'CONTEXT'}
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-300">{evidence.summary}</p>
      {evidence.source_url && (
        <a
          href={evidence.source_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-blue hover:underline"
        >
          {evidence.source_url} <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

// ---------- RecommendationCard ----------
export function RecommendationCard({ rec, index }: { rec: Recommendation; index: number }) {
  const c = severityClasses(rec.priority);
  return (
    <div className="flex gap-3 rounded-lg border border-space-700 bg-space-800/60 p-3.5">
      <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-accent-blue/15 text-xs font-bold text-accent-blue">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-100">{rec.action}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${c.bg} ${c.text}`}>{rec.priority}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">{rec.rationale}</p>
      </div>
    </div>
  );
}

// ---------- InvestigationRow (list) ----------
export function InvestigationRow({ inv }: { inv: Investigation }) {
  const c = investigationStatusClasses(inv.status);
  return (
    <Link
      to={`/investigations/${inv.id}`}
      className="flex items-center gap-4 border-b border-space-700 px-4 py-3 transition-colors last:border-0 hover:bg-space-800"
    >
      <div className="w-16 font-mono text-xs text-slate-500">INV#{inv.id}</div>
      <div className="w-24 font-semibold text-slate-200">{inv.satellite_id}</div>
      <div className="min-w-0 flex-1 truncate text-sm text-slate-300">
        {inv.root_cause ? humanize(inv.root_cause) : inv.title}
      </div>
      <SeverityBadge severity={inv.priority} />
      <div className="w-16 text-right font-mono text-xs text-slate-400">
        {inv.confidence != null ? `${Math.round(inv.confidence * 100)}%` : '—'}
      </div>
      <span className={`w-40 rounded px-2 py-0.5 text-center text-[11px] font-semibold uppercase ${c.bg} ${c.text}`}>
        {humanize(inv.status)}
      </span>
      <div className="w-20 text-right text-[11px] text-slate-500">{timeAgo(inv.created_at)}</div>
    </Link>
  );
}
