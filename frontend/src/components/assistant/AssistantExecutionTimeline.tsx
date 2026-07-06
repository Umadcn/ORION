import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

export interface TimelineEvent { type: string; detail?: string; seq: number }

/**
 * Staged execution timeline (from the SSE progress stream). Shows ONLY safe
 * stage events — never hidden reasoning, raw prompts, raw responses, tool
 * payloads, or vectors.
 */
export function AssistantExecutionTimeline({ events, active }: { events: TimelineEvent[]; active: boolean }) {
  if (!events.length) return null;
  return (
    <div className="space-y-1 rounded-lg border border-space-700 bg-space-900/60 p-2.5">
      {events.map((e, i) => {
        const isLast = i === events.length - 1;
        const done = e.type === 'ANSWER_READY' || !isLast;
        const failed = e.type === 'FAILED';
        return (
          <div key={e.seq} className="flex items-center gap-2 text-[11px]">
            {failed ? <Circle className="h-3 w-3 text-accent-red" /> : done ? <CheckCircle2 className="h-3 w-3 text-accent-green" /> : active ? <Loader2 className="h-3 w-3 animate-spin text-accent-cyan" /> : <Circle className="h-3 w-3 text-slate-600" />}
            <span className="text-slate-400">{label(e.type)}</span>
            {e.detail ? <span className="text-slate-600">· {e.detail}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function label(type: string): string {
  return ({
    ASSISTANT_STARTED: 'Started', CONTEXT_RESOLVED: 'Context resolved', INTENT_CLASSIFIED: 'Intent classified',
    TOOL_STARTED: 'Tool started', TOOL_COMPLETED: 'Tool completed', RETRIEVAL_STARTED: 'Retrieval started',
    RETRIEVAL_COMPLETED: 'Retrieval completed', PLANNER_STARTED: 'Planner started', PLANNER_COMPLETED: 'Planner completed',
    CRITIC_STARTED: 'Critic started', CRITIC_COMPLETED: 'Critic completed', VALIDATING_ANSWER: 'Validating answer',
    ANSWER_READY: 'Answer ready', FAILED: 'Failed',
  } as Record<string, string>)[type] ?? type;
}
