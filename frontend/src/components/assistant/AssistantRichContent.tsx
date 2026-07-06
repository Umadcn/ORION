import { Satellite, Activity, AlertTriangle, FileText, Search, Bot, ShieldCheck, ClipboardList } from 'lucide-react';
import type { AssistantRichContent as RC } from '../../api/client';
import { richContentTitle, criticDecisionLabel } from '../../lib/assistant';

/**
 * Renders validated, structured rich-content cards. NEVER renders model-generated
 * HTML and never uses dangerouslySetInnerHTML — all fields are read from the
 * validated structured payload and rendered as plain React nodes.
 */
export function AssistantRichContent({ items }: { items: RC[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map((rc, i) => (
        <div key={i} className="rounded-lg border border-space-700 bg-space-900/60 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {iconFor(rc.type)} {richContentTitle(rc.type)}
          </div>
          <Card rc={rc} />
        </div>
      ))}
    </div>
  );
}

function iconFor(type: string) {
  const c = 'h-3.5 w-3.5';
  if (type.startsWith('SATELLITE')) return <Satellite className={c} />;
  if (type.startsWith('TELEMETRY')) return <Activity className={c} />;
  if (type.startsWith('ALERT')) return <AlertTriangle className={c} />;
  if (type.startsWith('REPORT')) return <FileText className={c} />;
  if (type.startsWith('KNOWLEDGE')) return <Search className={c} />;
  if (type.startsWith('PLANNER') || type.startsWith('VALIDATED')) return <Bot className={c} />;
  if (type.startsWith('CRITIC')) return <ShieldCheck className={c} />;
  return <ClipboardList className={c} />;
}

function str(v: unknown): string { return v === null || v === undefined ? '' : String(v); }

function Card({ rc }: { rc: RC }) {
  const d = rc.data as Record<string, unknown>;
  switch (rc.type) {
    case 'SATELLITE_STATUS_CARD':
    case 'TELEMETRY_SUMMARY': {
      const t = (d.telemetry ?? {}) as Record<string, unknown>;
      return (
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
          <div><span className="text-slate-500">Satellite</span> {str(d.satelliteId)}</div>
          {d.status !== undefined && <div><span className="text-slate-500">Status</span> {str(d.status)}</div>}
          {t.battery_percent !== undefined && <div><span className="text-slate-500">Battery</span> {str(t.battery_percent)}%</div>}
          {t.temperature_c !== undefined && <div><span className="text-slate-500">Temp</span> {str(t.temperature_c)} C</div>}
          {t.signal_strength_dbm !== undefined && <div><span className="text-slate-500">Signal</span> {str(t.signal_strength_dbm)} dBm</div>}
          {t.power_consumption_w !== undefined && <div><span className="text-slate-500">Power</span> {str(t.power_consumption_w)} W</div>}
        </div>
      );
    }
    case 'ALERT_SUMMARY':
      return <ul className="space-y-0.5 text-xs text-slate-300">{((d.alerts as string[]) ?? []).map((a, i) => <li key={i}>• {a}</li>)}</ul>;
    case 'INVESTIGATION_SUMMARY':
      return (
        <div className="text-xs text-slate-300">
          <div><span className="text-slate-500">Investigation</span> {str(d.investigationId)} · <span className="text-slate-500">Satellite</span> {str(d.satelliteId)}</div>
          <div className="mt-1"><span className="text-slate-500">Root cause</span> {str(d.rootCause)}</div>
          {d.explanation ? <p className="mt-1 text-slate-400">{str(d.explanation)}</p> : null}
        </div>
      );
    case 'EVIDENCE_LIST':
      return <ul className="space-y-1 text-xs text-slate-300">{((d.evidence as Record<string, unknown>[]) ?? []).map((e, i) => <li key={i}><span className="text-accent-cyan">{str(e.evidenceId)}</span> — {str(e.summary)}</li>)}</ul>;
    case 'HISTORICAL_INCIDENT_LIST':
      return <ul className="space-y-0.5 text-xs text-slate-300">{((d.incidents as Record<string, unknown>[]) ?? []).map((h, i) => <li key={i}>#{str(h.investigationId)} {str(h.satelliteId)} — {str(h.rootCause)}</li>)}</ul>;
    case 'KNOWLEDGE_SOURCE_LIST':
      return <ul className="space-y-1 text-xs text-slate-300">{((d.sources as Record<string, unknown>[]) ?? []).map((s, i) => <li key={i}><span className="text-accent-cyan">{str(s.citationId)}</span> {str(s.documentTitle ?? '')} — {str(s.excerpt)}</li>)}</ul>;
    case 'PLANNER_ANALYSIS_CARD':
    case 'VALIDATED_ANALYSIS_CARD':
      return (
        <div className="text-xs text-slate-300">
          <p className="text-slate-300">{str(d.summary ?? (d.planner as Record<string, unknown>)?.summary)}</p>
          <div className="mt-1 text-[10px] italic text-accent-orange">Advisory only · human review required · deterministic RCA remains authoritative.</div>
          {rc.type === 'VALIDATED_ANALYSIS_CARD' && <div className="mt-1 text-[11px] text-slate-400">Critic: {criticDecisionLabel(str(d.criticDecision) || null)}</div>}
        </div>
      );
    case 'CRITIC_REVIEW_CARD':
      return (
        <div className="text-xs text-slate-300">
          <div>Decision: <span className="text-slate-200">{criticDecisionLabel(str(d.finalDecision) || null)}</span></div>
          <p className="mt-1 text-slate-400">{str(d.summary)}</p>
          <div className="mt-1 text-[10px] italic text-accent-orange">Analysis-quality review only — never a mission approval/rejection. Human review required.</div>
        </div>
      );
    default:
      return <pre className="whitespace-pre-wrap text-[11px] text-slate-400">{JSON.stringify(d, null, 2).slice(0, 600)}</pre>;
  }
}
