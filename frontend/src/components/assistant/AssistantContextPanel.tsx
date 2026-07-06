import { Satellite, FileSearch, Bot, ShieldCheck, Database, Cpu } from 'lucide-react';
import type { AssistantResult, AssistantStatus } from '../../api/client';
import { providerModeBanner, groundingSupportLabel } from '../../lib/assistant';

/**
 * Right-hand context panel: active entities, provider/embedding mode, grounding
 * status, and limitations. Provider mode is honest (offline ≠ real AI).
 */
export function AssistantContextPanel({ status, last }: { status: AssistantStatus | null; last: AssistantResult | null }) {
  const banner = providerModeBanner(status?.offline_mode ?? true, status?.llm_operating_mode ?? 'DETERMINISTIC_FALLBACK');
  const ctx = (last?.context ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-3 text-xs">
      <div className={`rounded-lg border p-2.5 ${banner.tone === 'offline' ? 'border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan' : 'border-accent-green/40 bg-accent-green/10 text-accent-green'}`}>
        <div className="flex items-center gap-1.5 font-semibold"><Cpu className="h-3.5 w-3.5" /> {banner.label}</div>
        <div className="mt-1 text-[10px] text-slate-400">Embedding: {status?.embedding_operating_mode ?? 'LOCAL_HASH_FALLBACK'}</div>
      </div>

      <Section icon={<Satellite className="h-3.5 w-3.5" />} title="Active context">
        <Row label="Satellite" value={strOrDash(ctx.satelliteId)} />
        <Row label="Investigation" value={strOrDash(ctx.investigationId)} />
        <Row label="Report" value={strOrDash(ctx.reportId)} />
        <Row label="Planner exec" value={strOrDash(ctx.plannerExecutionId)} />
        <Row label="Critic exec" value={strOrDash(ctx.criticExecutionId)} />
      </Section>

      {last && (
        <Section icon={<FileSearch className="h-3.5 w-3.5" />} title="This answer">
          <Row label="Intent" value={last.diagnostics.intent} />
          <Row label="Capability" value={last.diagnostics.capability ?? '—'} />
          <Row label="Mode" value={last.executionMode} />
          <Row label="Grounding" value={last.diagnostics.groundingValid ? 'valid' : 'insufficient'} />
          <Row label="Support" value={groundingSupportLabel(last.diagnostics.averageGroundingSupport)} />
          <Row label="Quality gate" value={last.diagnostics.qualityGate} />
          <Row label="Tools / retrieval" value={`${last.diagnostics.toolCallCount} / ${last.diagnostics.retrievalCallCount}`} />
        </Section>
      )}

      {last && last.citations.length > 0 && (
        <Section icon={<Database className="h-3.5 w-3.5" />} title="Citations">
          {last.citations.map((c) => <div key={c.citationId} className="truncate text-accent-cyan">{c.citationId}</div>)}
        </Section>
      )}

      {last && last.workflowResults.length > 0 && (
        <Section icon={<Bot className="h-3.5 w-3.5" />} title="Workflows (advisory)">
          {last.workflowResults.map((w, i) => (
            <div key={i} className="text-slate-300"><ShieldCheck className="mr-1 inline h-3 w-3 text-accent-orange" />{w.workflow} · {w.executionMode} · human review required</div>
          ))}
        </Section>
      )}

      {last && last.answer.limitations.length > 0 && (
        <Section icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Limitations">
          {last.answer.limitations.map((l, i) => <div key={i} className="text-slate-400">• {l}</div>)}
        </Section>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-space-700 bg-space-900/60 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{icon} {title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-2"><span className="text-slate-500">{label}</span><span className="text-right text-slate-300">{value}</span></div>;
}
function strOrDash(v: unknown): string { return v === null || v === undefined ? '—' : String(v); }
