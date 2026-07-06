/**
 * ORION AI Assistant bounded conversation memory (Phase 10).
 *
 * Reuses the Phase 5 short-term message store; adds a bounded retained-message
 * window, a bounded conversation summary (deterministic OR optional real-provider
 * through LlmRunner with a strict schema), and per-conversation active-entity
 * state. Safe context compression triggers when the message count exceeds the
 * retained window. No secrets, no hidden reasoning, no raw tool payloads, no raw
 * provider responses, no fabricated ids, bounded size, per-user isolation (the
 * caller enforces ownership).
 *
 * This is short-term memory only — Phase 10 does NOT implement long-term
 * semantic memory.
 */
import { db } from '../db.js';
import { config, redactSecrets } from '../config.js';
import { LlmRunner, llmRunner } from '../llm/runner.js';
import { isRealLlmConfigured } from '../config.js';
import { ASSISTANT_SUMMARY_SCHEMA, ASSISTANT_SUMMARY_SCHEMA_NAME } from './assistantSchemas.js';
import { ASSISTANT_SUMMARY_VERSION, ASSISTANT_SUMMARY_SYSTEM_PROMPT, buildSummaryUserPrompt } from './prompt.js';
import { setConversationSummary } from './assistantRepository.js';
import type { MessageRow } from '../copilot/types.js';
import type { AssistantContextSummary } from './types.js';

/** Most-recent retained messages for reasoning context, oldest → newest. */
export function retainedMessages(conversationId: string): MessageRow[] {
  const n = config.assistant.maxRetainedMessages;
  const rows = db.prepare('SELECT * FROM copilot_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?').all(conversationId, n) as MessageRow[];
  return rows.reverse();
}

export function totalMessageCount(conversationId: string): number {
  const r = db.prepare('SELECT COUNT(*) AS c FROM copilot_messages WHERE conversation_id = ?').get(conversationId) as { c: number };
  return r.c;
}

/** Deterministic bounded summary of the older (out-of-window) messages. */
function deterministicSummary(older: MessageRow[]): string {
  const userMsgs = older.filter((m) => m.role === 'user').slice(-8).map((m) => m.content.replace(/\s+/g, ' ').trim());
  const topics = userMsgs.map((t) => (t.length > 80 ? t.slice(0, 80) + '…' : t));
  const s = `Earlier in this conversation the user asked about: ${topics.join(' | ')}.`;
  return redactSecrets(s).slice(0, config.assistant.maxSummaryChars);
}

export interface MemoryDeps { runner?: LlmRunner; realProviderAvailable?: boolean }

export class AssistantMemoryService {
  private runner: LlmRunner;
  private realAvailable: boolean;
  constructor(deps: MemoryDeps = {}) {
    this.runner = deps.runner ?? llmRunner;
    this.realAvailable = deps.realProviderAvailable ?? isRealLlmConfigured();
  }

  /**
   * If the conversation exceeds the retained window, (re)compute a bounded
   * summary. Real-provider summary is adopted ONLY if it validates; otherwise
   * the deterministic summary is used. Returns the summary (or null if none needed).
   */
  async maybeSummarize(conversationId: string, correlationId?: string): Promise<AssistantContextSummary | null> {
    const total = totalMessageCount(conversationId);
    const window = config.assistant.maxRetainedMessages;
    if (total <= window) return null;

    const all = db.prepare('SELECT * FROM copilot_messages WHERE conversation_id = ? ORDER BY id ASC').all(conversationId) as MessageRow[];
    const older = all.slice(0, Math.max(0, all.length - window));
    if (older.length === 0) return null;

    let summaryText = deterministicSummary(older);
    let source: 'DETERMINISTIC' | 'REAL_PROVIDER' = 'DETERMINISTIC';

    if (this.realAvailable) {
      try {
        const resp = await this.runner.run<{ summary: string }>({
          requestType: 'assistant-summary', promptVersion: ASSISTANT_SUMMARY_VERSION,
          messages: [
            { role: 'system', content: ASSISTANT_SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: buildSummaryUserPrompt(older) },
          ],
          structuredOutput: { name: ASSISTANT_SUMMARY_SCHEMA_NAME, schema: ASSISTANT_SUMMARY_SCHEMA },
          correlationId,
        });
        if (resp.executionMode === 'REAL_PROVIDER' && resp.structured && typeof resp.structured.summary === 'string' && resp.structured.summary.trim().length > 0) {
          // Reject secret-shaped or oversized content; else adopt.
          const cleaned = redactSecrets(resp.structured.summary).slice(0, config.assistant.maxSummaryChars);
          if (cleaned.trim().length > 0) { summaryText = cleaned; source = 'REAL_PROVIDER'; }
        }
      } catch { /* keep deterministic */ }
    }

    const summary: AssistantContextSummary = { summary: summaryText, source, messageCountSummarized: older.length };
    setConversationSummary(conversationId, summary);
    return summary;
  }
}

export const assistantMemoryService = new AssistantMemoryService();
