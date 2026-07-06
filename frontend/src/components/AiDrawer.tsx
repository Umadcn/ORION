import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Plus, Send, Wrench, FileText, X, MessageSquare, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import type { CopilotAnswer, CopilotConversation, CopilotMessage } from '../api/client';
import { EmptyState, LoadingState } from './ui';
import { copilotModeBadge } from '../lib/format';

/**
 * Mission Copilot — a READ-ONLY conversational assistant over ORION's
 * deterministic pipeline + grounded mission knowledge. It answers via the
 * backend Copilot (controlled read-only tool calling); every answer carries an
 * execution-mode badge, citations, evidence references, and a tool-activity
 * summary. Hidden chain-of-thought and raw tool payloads are never shown.
 */

interface Turn {
  id: string;
  user: string;
  answer?: CopilotAnswer;
  error?: string;
  loading?: boolean;
}

const SUGGESTIONS = [
  'Why is ORION-5 unhealthy?',
  'Show the evidence for the root cause.',
  'Have similar incidents happened before?',
  'What is the latest telemetry for ORION-3?',
  'Show active alerts.',
];

export function AiDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    try { setConversations(await api.copilotConversations()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (open) void refreshConversations(); }, [open, refreshConversations]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [turns]);

  async function ensureConversation(): Promise<string> {
    if (activeId) return activeId;
    const conv = await api.copilotCreateConversation('Mission Copilot');
    setActiveId(conv.id);
    void refreshConversations();
    return conv.id;
  }

  async function selectConversation(id: string) {
    setActiveId(id);
    setLoadingConv(true);
    setTurns([]);
    try {
      const { messages } = await api.copilotConversation(id);
      setTurns(rebuildTurns(messages));
    } catch { /* ignore */ } finally { setLoadingConv(false); }
  }

  function newConversation() {
    setActiveId(null);
    setTurns([]);
    setInput('');
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput('');
    const turnId = `${Date.now()}`;
    setTurns((t) => [...t, { id: turnId, user: message, loading: true }]);
    try {
      const id = await ensureConversation();
      const answer = await api.copilotSend(id, message);
      setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, answer, loading: false } : x)));
      void refreshConversations();
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, error: (e as Error).message, loading: false } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={`fixed inset-0 z-50 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onClose} />
      <aside className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-space-700 bg-space-900 shadow-2xl transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-space-700 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent-purple/20 text-accent-purple"><Bot className="h-5 w-5" /></div>
            <div>
              <div className="text-sm font-bold text-white">ORION Mission Copilot</div>
              <div className="flex items-center gap-1 text-[11px] text-accent-green"><span className="h-1.5 w-1.5 rounded-full bg-accent-green" /> Read-only · grounded · tool-augmented</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={newConversation} title="New conversation" className="rounded-md border border-space-700 p-1.5 text-slate-400 hover:text-white"><Plus className="h-4 w-4" /></button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Conversation switcher */}
        {conversations.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-b border-space-800 px-4 py-2">
            {conversations.slice(0, 8).map((c) => (
              <button key={c.id} onClick={() => selectConversation(c.id)} className={`flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] ${activeId === c.id ? 'border-accent-purple/50 bg-accent-purple/15 text-white' : 'border-space-700 text-slate-400 hover:text-slate-200'}`}>
                <MessageSquare className="h-3 w-3" /> {c.title.slice(0, 20)}
              </button>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <p className="rounded-lg border border-space-700 bg-space-800/60 p-3 text-xs text-slate-400">
            Ask about investigations, root causes, evidence, telemetry, alerts, reports, and mission knowledge. The Copilot is read-only and cannot control satellites, run simulations, or change any data. Answers are grounded and cited.
          </p>

          {loadingConv && <LoadingState />}
          {turns.length === 0 && !loadingConv && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Try asking</div>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => void send(s)} className="block w-full rounded-lg border border-space-700 bg-space-800/50 px-3 py-2 text-left text-xs text-slate-300 hover:border-space-500">{s}</button>
              ))}
            </div>
          )}

          {turns.map((t) => (
            <div key={t.id} className="space-y-2">
              <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-accent-purple/20 px-3 py-2 text-sm text-white">{t.user}</div>
              {t.loading && <div className="text-xs text-slate-500">ORION is analyzing…</div>}
              {t.error && <div className="flex items-center gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red"><AlertTriangle className="h-3.5 w-3.5" /> {t.error}</div>}
              {t.answer && <AnswerCard answer={t.answer} onFollowup={(q) => void send(q)} onClose={onClose} />}
            </div>
          ))}
        </div>

        <div className="border-t border-space-700 p-3">
          <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the Mission Copilot…"
              maxLength={2000}
              disabled={busy}
              className="flex-1 rounded-lg border border-space-700 bg-space-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-accent-purple focus:outline-none"
            />
            <button type="submit" disabled={busy || !input.trim()} className="btn-primary px-3 py-2 disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      </aside>
    </>
  );
}

function AnswerCard({ answer, onFollowup, onClose }: { answer: CopilotAnswer; onFollowup: (q: string) => void; onClose: () => void }) {
  const badge = copilotModeBadge(answer.status);
  return (
    <div className="max-w-[92%] space-y-2 rounded-lg rounded-tl-sm border border-space-700 bg-space-800/60 px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.bg} ${badge.text}`}>{badge.label}</span>
        {answer.toolActivity.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-slate-500"><Wrench className="h-3 w-3" /> {answer.toolActivity.length} tool{answer.toolActivity.length > 1 ? 's' : ''}</span>
        )}
      </div>

      <p className="whitespace-pre-wrap text-slate-200">{answer.answer}</p>

      {answer.citations.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Citations</div>
          <ul className="space-y-1">
            {answer.citations.map((c) => (
              <li key={c.citationId}>
                <Link to={`/reports`} onClick={onClose} className="flex items-center gap-1 text-[11px] text-accent-cyan hover:underline" title={c.citationId}>
                  <FileText className="h-3 w-3" /> {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.evidenceIds.length > 0 && (
        <div className="text-[11px] text-slate-400"><span className="font-semibold text-slate-500">Evidence:</span> {answer.evidenceIds.map((e) => `#${e}`).join(', ')}</div>
      )}

      {answer.toolActivity.length > 0 && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer">Tool activity</summary>
          <ul className="mt-1 space-y-0.5">
            {answer.toolActivity.map((t, i) => (
              <li key={i} className="flex items-center justify-between"><span className="text-slate-400">{t.toolName}</span><span className={t.status === 'SUCCESS' ? 'text-accent-green' : 'text-accent-orange'}>{t.status}</span></li>
            ))}
          </ul>
        </details>
      )}

      {answer.limitations.length > 0 && (
        <div className="text-[10px] italic text-slate-500">{answer.limitations.join(' · ')}</div>
      )}

      {answer.suggestedFollowups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {answer.suggestedFollowups.map((q) => (
            <button key={q} onClick={() => onFollowup(q)} className="rounded-full border border-space-700 px-2 py-0.5 text-[10px] text-slate-400 hover:border-accent-purple/50 hover:text-white">{q}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rebuild display turns from persisted messages (user + assistant text only). */
function rebuildTurns(messages: CopilotMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: string | null = null;
  for (const m of messages) {
    if (m.role === 'user') {
      if (pendingUser !== null) turns.push({ id: `${m.id}-u`, user: pendingUser });
      pendingUser = m.content;
    } else {
      turns.push({
        id: `${m.id}`,
        user: pendingUser ?? '',
        answer: historyAnswer(m),
      });
      pendingUser = null;
    }
  }
  if (pendingUser !== null) turns.push({ id: 'tail-u', user: pendingUser });
  return turns;
}

/** A minimal answer card for historical assistant messages (text + mode only). */
function historyAnswer(m: CopilotMessage): CopilotAnswer {
  return {
    conversationId: m.conversation_id, messageId: m.id, correlationId: '',
    executionMode: (m.execution_mode as CopilotAnswer['executionMode']) ?? 'DETERMINISTIC_FALLBACK',
    status: (m.execution_mode as CopilotAnswer['status']) ?? 'DETERMINISTIC_FALLBACK',
    answer: m.content, claims: [], citations: [], evidenceIds: [], limitations: [], suggestedFollowups: [],
    toolActivity: [], diagnostics: { iterationCount: 0, toolCallCount: 0, claimCount: 0, supportedClaimCount: 0, groundingValid: true, policyValid: true, averageGroundingSupport: null, terminationReason: 'HISTORY' },
    disclaimer: '',
  };
}
