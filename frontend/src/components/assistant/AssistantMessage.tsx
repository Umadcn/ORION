import { Wrench, FileText, Beaker, Bot } from 'lucide-react';
import type { AssistantResult, AssistantAnswer, AssistantCitation, AssistantWorkflowResult, AssistantToolResult } from '../../api/client';
import { executionModeBadge, statusLabel } from '../../lib/assistant';
import { AssistantRichContent } from './AssistantRichContent';
import { AssistantFeedback } from './AssistantFeedback';

interface Props {
  answer: AssistantAnswer;
  mode: string;
  status: string;
  citations: AssistantCitation[];
  evidenceIds: string[];
  workflowResults: AssistantWorkflowResult[];
  toolActivity: AssistantToolResult[];
  richContent: AssistantResult['richContent'];
  suggestedFollowups: string[];
  messageId: number | null;
  onFollowup: (q: string) => void;
  onInspectCitation: (id: string) => void;
}

/** A single assistant answer card. Honest badges; no hidden reasoning shown. */
export function AssistantMessage(p: Props) {
  const badge = executionModeBadge(p.mode);
  const citeIds = new Set<string>([...p.citations.map((c) => c.citationId), ...p.answer.claims.flatMap((c) => c.citation_ids)]);
  return (
    <div className="max-w-[92%] space-y-2.5 rounded-lg rounded-tl-sm border border-space-700 bg-space-800/60 px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.bg} ${badge.text}`}>{badge.label}</span>
        <span className="text-[10px] text-slate-500">{statusLabel(p.status)}</span>
        {p.toolActivity.length > 0 && <span className="flex items-center gap-1 text-[10px] text-slate-500"><Wrench className="h-3 w-3" /> {p.toolActivity.length}</span>}
      </div>

      {p.answer.title && <div className="text-sm font-semibold text-white">{p.answer.title}</div>}
      <p className="whitespace-pre-wrap text-slate-200">{p.answer.summary}</p>

      {p.answer.sections?.map((s, i) => (
        <div key={i}><div className="text-xs font-semibold text-slate-300">{s.heading}</div><p className="whitespace-pre-wrap text-xs text-slate-400">{s.body}</p></div>
      ))}

      {p.richContent.length > 0 && <AssistantRichContent items={p.richContent} />}

      {p.workflowResults.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {p.workflowResults.map((w, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full border border-accent-orange/40 bg-accent-orange/10 px-2 py-0.5 text-[10px] text-accent-orange">
              <Bot className="h-3 w-3" /> {w.workflow} · {w.executionMode} · human review
            </span>
          ))}
        </div>
      )}

      {citeIds.size > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Citations</div>
          <div className="flex flex-wrap gap-1.5">
            {[...citeIds].map((id) => {
              const c = p.citations.find((x) => x.citationId === id);
              return (
                <button key={id} onClick={() => p.onInspectCitation(id)} title={id} className="flex items-center gap-1 rounded-full border border-space-700 px-2 py-0.5 text-[10px] text-accent-cyan hover:border-accent-cyan/50">
                  <FileText className="h-3 w-3" /> {c ? c.title.slice(0, 28) : id}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {p.evidenceIds.length > 0 && (
        <div className="text-[11px] text-slate-400"><span className="font-semibold text-slate-500">Evidence:</span> {p.evidenceIds.map((e) => <span key={e} className="mr-1 inline-flex items-center gap-0.5"><Beaker className="h-3 w-3" />{e}</span>)}</div>
      )}

      {p.toolActivity.length > 0 && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer">Tool activity</summary>
          <ul className="mt-1 space-y-0.5">
            {p.toolActivity.map((t, i) => (
              <li key={i} className="flex items-center justify-between"><span className="text-slate-400">{t.toolName}</span><span className={t.status === 'SUCCESS' ? 'text-accent-green' : 'text-accent-orange'}>{t.status}</span></li>
            ))}
          </ul>
        </details>
      )}

      {p.answer.limitations.length > 0 && <div className="text-[10px] italic text-slate-500">{p.answer.limitations.join(' · ')}</div>}

      {p.suggestedFollowups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {p.suggestedFollowups.map((q) => (
            <button key={q} onClick={() => p.onFollowup(q)} className="rounded-full border border-space-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-accent-purple/50 hover:text-white">{q}</button>
          ))}
        </div>
      )}

      {p.messageId !== null && <AssistantFeedback messageId={p.messageId} />}
    </div>
  );
}
