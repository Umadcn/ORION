import { useEffect, useRef } from 'react';
import { AlertTriangle, Bot } from 'lucide-react';
import type { AssistantResult } from '../../api/client';
import { AssistantMessage } from './AssistantMessage';
import { AssistantExecutionTimeline, type TimelineEvent } from './AssistantExecutionTimeline';
import { LoadingState } from '../ui';

export interface Turn {
  id: string;
  user: string;
  result?: AssistantResult;
  error?: string;
  loading?: boolean;
  events?: TimelineEvent[];
}

/** Center chat transcript. Empty/loading states + per-turn timeline + answers. */
export function AssistantChat({ turns, loadingConv, onFollowup, onInspectCitation }: {
  turns: Turn[]; loadingConv: boolean; onFollowup: (q: string) => void; onInspectCitation: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
      {loadingConv && <LoadingState />}
      {!loadingConv && turns.length === 0 && (
        <div className="mx-auto max-w-md pt-16 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent-purple/20 text-accent-purple"><Bot className="h-6 w-6" /></div>
          <div className="text-lg font-semibold text-white">ORION AI Assistant</div>
          <p className="mt-1 text-sm text-slate-400">Read-only, grounded, tool-augmented. Ask about satellites, telemetry, alerts, investigations, evidence, reports, mission knowledge, and advisory Planner/Critic analyses.</p>
        </div>
      )}
      {turns.map((t) => (
        <div key={t.id} className="space-y-2">
          <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-accent-purple/20 px-3 py-2 text-sm text-white">{t.user}</div>
          {t.events && t.events.length > 0 && (!t.result || t.loading) && <AssistantExecutionTimeline events={t.events} active={!!t.loading} />}
          {t.loading && (!t.events || t.events.length === 0) && <div className="text-xs text-slate-500">ORION is analyzing…</div>}
          {t.error && <div className="flex items-center gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red"><AlertTriangle className="h-3.5 w-3.5" /> {t.error}</div>}
          {t.result && (
            <AssistantMessage
              answer={t.result.answer}
              mode={t.result.executionMode}
              status={t.result.status}
              citations={t.result.citations}
              evidenceIds={t.result.evidenceIds}
              workflowResults={t.result.workflowResults}
              toolActivity={t.result.toolActivity}
              richContent={t.result.richContent}
              suggestedFollowups={t.result.suggestedFollowups}
              messageId={t.result.messageId}
              onFollowup={onFollowup}
              onInspectCitation={onInspectCitation}
            />
          )}
        </div>
      ))}
    </div>
  );
}
