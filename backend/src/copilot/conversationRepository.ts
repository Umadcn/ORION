/**
 * Short-term conversation memory (Phase 5). Bounded message history. Stores only
 * sanitized content — no secrets, no raw prompts, no hidden chain-of-thought,
 * no raw vectors, no unrestricted tool outputs. No long-term semantic memory.
 */
import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { config } from '../config.js';
import type { ConversationRow, MessageRow } from './types.js';

export function createConversation(userId: string, role: string, title: string): ConversationRow {
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO copilot_conversations (id, user_id, role, title, status, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, NULL)`,
  ).run(id, userId, role, title.slice(0, 120), ts, ts);
  return getConversation(id)!;
}

export function getConversation(id: string): ConversationRow | undefined {
  return db.prepare('SELECT * FROM copilot_conversations WHERE id = ?').get(id) as ConversationRow | undefined;
}

export function listConversations(userId: string, limit = 50): ConversationRow[] {
  const lim = Math.max(1, Math.min(Math.floor(limit), 200));
  return db
    .prepare(`SELECT * FROM copilot_conversations WHERE user_id = ? AND status = 'ACTIVE' ORDER BY updated_at DESC LIMIT ?`)
    .all(userId, lim) as ConversationRow[];
}

export function archiveConversation(id: string): void {
  db.prepare(`UPDATE copilot_conversations SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), id);
}

export function touchConversation(id: string): void {
  db.prepare('UPDATE copilot_conversations SET updated_at = ? WHERE id = ?').run(now(), id);
}

export function addMessage(conversationId: string, role: 'user' | 'assistant', content: string, executionMode: string | null, correlationId: string | null): number {
  const info = db
    .prepare(
      `INSERT INTO copilot_messages (conversation_id, role, content, execution_mode, correlation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(conversationId, role, content, executionMode, correlationId, now());
  touchConversation(conversationId);
  return Number(info.lastInsertRowid);
}

/** A single message row by id (for ownership checks / feedback linkage). */
export function getMessageById(id: number): MessageRow | undefined {
  return db.prepare('SELECT * FROM copilot_messages WHERE id = ?').get(id) as MessageRow | undefined;
}

/** Full message list (bounded) for display, oldest → newest. */
export function getMessages(conversationId: string, limit = 200): MessageRow[] {
  const lim = Math.max(1, Math.min(Math.floor(limit), 500));
  return db
    .prepare('SELECT * FROM copilot_messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?')
    .all(conversationId, lim) as MessageRow[];
}

/** The most recent N messages for reasoning context, returned oldest → newest. */
export function getContextMessages(conversationId: string): MessageRow[] {
  const n = config.copilot.maxRetainedMessages;
  const rows = db
    .prepare('SELECT * FROM copilot_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
    .all(conversationId, n) as MessageRow[];
  return rows.reverse();
}
