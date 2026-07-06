import { useCallback, useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { api } from '../api/client';
import type { AssistantResult, AssistantStatus, CopilotConversation, AssistantHistoryMessage } from '../api/client';
import { AssistantSidebar } from '../components/assistant/AssistantSidebar';
import { AssistantChat, type Turn } from '../components/assistant/AssistantChat';
import { AssistantComposer } from '../components/assistant/AssistantComposer';
import { AssistantContextPanel } from '../components/assistant/AssistantContextPanel';
import { AssistantSourceDrawer } from '../components/assistant/AssistantSourceDrawer';
import type { TimelineEvent } from '../components/assistant/AssistantExecutionTimeline';

/**
 * ORION AI Assistant — full-page agentic chatbot experience (Phase 10). Reuses
 * the assistant backend (read-only). Left: conversations. Center: chat with
 * safe staged streaming. Right: live context/provider/grounding panel. Honest
 * labeling throughout (fallback is never shown as real AI).
 */
export default function AiAssistantPage() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [last, setLast] = useState<AssistantResult | null>(null);
  const [inspectCitation, setInspectCitation] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    try { setConversations(await api.assistantConversations()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void api.assistantStatus().then(setStatus).catch(() => null); void refreshConversations(); }, [refreshConversations]);

  async function ensureConversation(): Promise<string> {
    if (activeId) return activeId;
    const conv = await api.assistantCreateConversation('ORION AI Assistant');
    setActiveId(conv.id);
    void refreshConversations();
    return conv.id;
  }

  async function selectConversation(id: string) {
    setActiveId(id);
    setLoadingConv(true);
    setTurns([]);
    setLast(null);
    try {
      const { messages } = await api.assistantConversation(id);
      setTurns(rebuildTurns(messages));
    } catch { /* ignore */ } finally { setLoadingConv(false); }
  }

  function newConversation() { setActiveId(null); setTurns([]); setLast(null); }

  async function archive(id: string) {
    try { await api.assistantArchive(id); } catch { /* ignore */ }
    if (id === activeId) newConversation();
    void refreshConversations();
  }

  async function send(text: string) {
    if (busy) return;
    setBusy(true);
    const turnId = `${Date.now()}`;
    setTurns((t) => [...t, { id: turnId, user: text, loading: true, events: [] }]);
    try {
      const id = await ensureConversation();
      const onProgress = (e: { type: string; detail?: string }) => {
        setTurns((t) => t.map((x) => x.id === turnId ? { ...x, events: [...(x.events ?? []), { ...e, seq: (x.events?.length ?? 0) } as TimelineEvent] } : x));
      };
      const result = await api.assistantStream(id, text, onProgress);
      setTurns((t) => t.map((x) => x.id === turnId ? { ...x, result, loading: false } : x));
      setLast(result);
      void refreshConversations();
    } catch (e) {
      setTurns((t) => t.map((x) => x.id === turnId ? { ...x, error: (e as Error).message, loading: false } : x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center gap-2.5 border-b border-space-700 px-5 py-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent-purple/20 text-accent-purple"><Bot className="h-5 w-5" /></div>
        <div>
          <div className="text-sm font-bold text-white">ORION AI Assistant</div>
          <div className="text-[11px] text-accent-green">Read-only · grounded · agentic · advisory</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="hidden md:block">
          <AssistantSidebar conversations={conversations} activeId={activeId} onNew={newConversation} onSelect={selectConversation} onArchive={archive} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <AssistantChat turns={turns} loadingConv={loadingConv} onFollowup={send} onInspectCitation={setInspectCitation} />
          <AssistantComposer busy={busy} showSuggestions={turns.length === 0} onSend={send} />
        </div>

        <div className="hidden w-72 overflow-y-auto border-l border-space-700 bg-space-900/40 p-3 lg:block">
          <AssistantContextPanel status={status} last={last} />
        </div>
      </div>

      <AssistantSourceDrawer citationId={inspectCitation} onClose={() => setInspectCitation(null)} />
    </div>
  );
}

/** Rebuild display turns from persisted messages (user + assistant card). */
function rebuildTurns(messages: AssistantHistoryMessage[]): Turn[] {
  const turns: Turn[] = [];
  let pendingUser: string | null = null;
  for (const m of messages) {
    if (m.role === 'user') {
      if (pendingUser !== null) turns.push({ id: `${m.id}-u`, user: pendingUser });
      pendingUser = m.content;
    } else {
      turns.push({ id: `${m.id}`, user: pendingUser ?? '', result: historyResult(m) });
      pendingUser = null;
    }
  }
  if (pendingUser !== null) turns.push({ id: 'tail-u', user: pendingUser });
  return turns;
}

/** Reconstruct an AssistantResult-shaped object for a historical assistant message. */
function historyResult(m: AssistantHistoryMessage): AssistantResult {
  const card = m.card ?? { answer_version: 'v', title: '', summary: m.content, sections: [], claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: [], suggested_followups: [], rich_content: [] };
  return {
    conversationId: m.conversation_id, messageId: m.id, correlationId: '',
    executionMode: (m.execution_mode as AssistantResult['executionMode']) ?? 'DETERMINISTIC_FALLBACK',
    status: (m.status as AssistantResult['status']) ?? 'DETERMINISTIC',
    provider: null, model: null,
    answer: card,
    citations: (card.citations ?? []).map((id) => ({ citationId: id, documentId: 0, title: id })),
    evidenceIds: card.evidence_ids ?? [],
    workflowResults: [], toolActivity: [], richContent: card.rich_content ?? [],
    suggestedFollowups: card.suggested_followups ?? [], context: {},
    diagnostics: { intent: m.intent ?? 'MISSION_QA', capability: m.capability ?? null, iterationCount: 0, toolCallCount: 0, retrievalCallCount: 0, workflowCallCount: 0, claimCount: card.claims?.length ?? 0, supportedClaimCount: 0, citationCount: card.citations?.length ?? 0, evidenceCount: card.evidence_ids?.length ?? 0, groundingValid: true, policyValid: true, averageGroundingSupport: null, contextResolved: false, terminationReason: 'HISTORY', qualityGate: 'HISTORY' },
    disclaimer: '',
  };
}
