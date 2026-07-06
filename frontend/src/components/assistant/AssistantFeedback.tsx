import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { api } from '../../api/client';

const DOWN_REASONS = ['INCORRECT', 'UNSUPPORTED', 'MISSING_CONTEXT', 'BAD_CITATION', 'TOO_VERBOSE', 'OTHER'];

/** Bounded thumbs up/down feedback for a persisted assistant message. */
export function AssistantFeedback({ messageId }: { messageId: number }) {
  const [sent, setSent] = useState<null | 'up' | 'down'>(null);
  const [pickReason, setPickReason] = useState(false);

  async function submit(rating: 'THUMBS_UP' | 'THUMBS_DOWN', reason?: string) {
    try { await api.assistantFeedback(messageId, rating, reason); } catch { /* ignore */ }
    setSent(rating === 'THUMBS_UP' ? 'up' : 'down');
    setPickReason(false);
  }

  if (sent) return <div className="text-[10px] text-slate-500">Thanks for the feedback.</div>;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => void submit('THUMBS_UP', 'HELPFUL')} className="rounded border border-space-700 p-1 text-slate-400 hover:text-accent-green" title="Helpful"><ThumbsUp className="h-3 w-3" /></button>
      <button onClick={() => setPickReason((v) => !v)} className="rounded border border-space-700 p-1 text-slate-400 hover:text-accent-red" title="Not helpful"><ThumbsDown className="h-3 w-3" /></button>
      {pickReason && DOWN_REASONS.map((r) => (
        <button key={r} onClick={() => void submit('THUMBS_DOWN', r)} className="rounded-full border border-space-700 px-1.5 py-0.5 text-[9px] text-slate-400 hover:border-accent-red/50 hover:text-white">{r.replace(/_/g, ' ').toLowerCase()}</button>
      ))}
    </div>
  );
}
