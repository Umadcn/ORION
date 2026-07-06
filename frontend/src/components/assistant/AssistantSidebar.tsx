import { useState } from 'react';
import { Plus, MessageSquare, Search, Archive } from 'lucide-react';
import type { CopilotConversation } from '../../api/client';

/** Left sidebar: new chat, search, conversation history, archive. */
export function AssistantSidebar({
  conversations, activeId, onNew, onSelect, onArchive,
}: {
  conversations: CopilotConversation[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex h-full w-64 flex-col border-r border-space-700 bg-space-900/60">
      <div className="p-3">
        <button onClick={onNew} className="btn-primary flex w-full items-center justify-center gap-2 py-2 text-sm"><Plus className="h-4 w-4" /> New chat</button>
      </div>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-space-700 bg-space-800 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && <div className="px-2 py-4 text-center text-[11px] text-slate-600">No conversations</div>}
        {filtered.map((c) => (
          <div key={c.id} className={`group flex items-center gap-2 rounded-lg px-2 py-2 text-xs ${activeId === c.id ? 'bg-accent-purple/15 text-white' : 'text-slate-400 hover:bg-space-800'}`}>
            <button onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.title}</span>
            </button>
            <button onClick={() => onArchive(c.id)} title="Archive" className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent-orange"><Archive className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
