import { Bot } from 'lucide-react';
import robotUrl from '../assets/orion/assistant/orion-assistant-robot.svg';

/**
 * Sidebar "ORION AI Assistant" card. Expanded: title + online status + prompt +
 * large centered robot artwork + full-width orange CTA. Collapsed: a compact
 * launcher using the existing ORION AI (Bot) icon. Both open the existing AI
 * Assistant panel via `onOpen` — no routing/behavior change.
 */
export function SidebarAssistantCard({ collapsed, onOpen }: { collapsed: boolean; onOpen: () => void }) {
  if (collapsed) {
    return (
      <button
        onClick={onOpen}
        title="Ask Orion AI"
        aria-label="Ask Orion AI"
        className="grid h-10 w-full place-items-center rounded-lg bg-accent-orange/15 text-accent-orange transition-colors hover:bg-accent-orange/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/60"
      >
        <Bot className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-space-700 bg-space-900 p-3.5 shadow-[0_2px_10px_-6px_rgba(0,0,0,0.6)]">
      <div className="text-sm font-bold text-white">ORION AI ASSISTANT</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-accent-green">
        <span className="h-2 w-2 rounded-full bg-accent-green" /> Online
      </div>
      <p className="mt-2 text-xs leading-snug text-slate-400">How can I assist you today?</p>

      <div className="mt-2.5 flex items-center justify-center">
        <img
          src={robotUrl}
          alt="ORION AI Assistant"
          className="w-auto max-w-full object-contain"
          style={{ height: 'clamp(84px, 16vh, 158px)' }}
          draggable={false}
        />
      </div>

      <button
        onClick={onOpen}
        className="mt-3 flex h-10 w-full items-center justify-center rounded-lg bg-accent-orange px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/70 focus-visible:ring-offset-2 focus-visible:ring-offset-space-900 active:brightness-95"
      >
        Ask Orion AI
      </button>
    </div>
  );
}
