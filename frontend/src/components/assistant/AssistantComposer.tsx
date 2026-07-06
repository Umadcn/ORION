import { useState } from 'react';
import { Send } from 'lucide-react';

const SUGGESTIONS = [
  'Which satellites are unhealthy?',
  'Why is ORION-5 unhealthy?',
  'Show the evidence for the root cause.',
  'Have similar incidents happened before?',
  'What does the mission manual recommend?',
  'Run a validated analysis.',
];

/** Input composer with suggested prompts. */
export function AssistantComposer({ busy, showSuggestions, onSend }: { busy: boolean; showSuggestions: boolean; onSend: (text: string) => void }) {
  const [input, setInput] = useState('');
  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput('');
    onSend(t);
  }
  return (
    <div className="border-t border-space-700 p-3">
      {showSuggestions && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => submit(s)} disabled={busy} className="rounded-full border border-space-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-accent-purple/50 hover:text-white disabled:opacity-40">{s}</button>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); submit(input); }} className="flex items-center gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the ORION AI Assistant…" maxLength={2000} disabled={busy}
          className="flex-1 rounded-lg border border-space-700 bg-space-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-accent-purple focus:outline-none" />
        <button type="submit" disabled={busy || !input.trim()} className="btn-primary px-3.5 py-2.5 disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
