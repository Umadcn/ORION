/**
 * ORION AI Assistant persistence (Phase 10).
 *
 * Conversation state (bounded active-entity memory + summary), per-turn
 * executions, and user feedback. Conversations + messages reuse the Copilot
 * store (copilot_conversations / copilot_messages) — this module only adds the
 * assistant-specific bounded metadata. No secrets, no raw payloads, no hidden
 * reasoning.
 */
import { db, now } from '../db.js';
import { config } from '../config.js';
import type {
  AssistantConversationContext, AssistantContextSummary, AssistantExecutionMode,
  AssistantFeedback, AssistantFeedbackRating, AssistantFeedbackReason,
} from './types.js';

// --- Conversation state ----------------------------------------------------

interface StateRow {
  conversation_id: string;
  satellite_id: string | null;
  investigation_id: number | null;
  report_id: number | null;
  planner_execution_id: number | null;
  critic_execution_id: number | null;
  citation_ids_json: string | null;
  evidence_ids_json: string | null;
  topic: string | null;
  last_capability: string | null;
  last_execution_mode: string | null;
  summary: string | null;
  summary_source: string | null;
  summary_message_count: number;
  updated_at: string;
}

function parseArr(json: string | null): string[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map((x) => String(x)) : []; } catch { return []; }
}

const EMPTY_CONTEXT: AssistantConversationContext = {
  satelliteId: null, investigationId: null, reportId: null, plannerExecutionId: null,
  criticExecutionId: null, citationIds: [], evidenceIds: [], topic: null,
  lastCapability: null, lastExecutionMode: null,
};

export function getConversationContext(conversationId: string): AssistantConversationContext {
  const row = db.prepare('SELECT * FROM assistant_conversation_state WHERE conversation_id = ?').get(conversationId) as StateRow | undefined;
  if (!row) return { ...EMPTY_CONTEXT };
  return {
    satelliteId: row.satellite_id,
    investigationId: row.investigation_id,
    reportId: row.report_id,
    plannerExecutionId: row.planner_execution_id,
    criticExecutionId: row.critic_execution_id,
    citationIds: parseArr(row.citation_ids_json),
    evidenceIds: parseArr(row.evidence_ids_json),
    topic: row.topic,
    lastCapability: (row.last_capability as AssistantConversationContext['lastCapability']) ?? null,
    lastExecutionMode: (row.last_execution_mode as AssistantExecutionMode | null) ?? null,
  };
}

export function getConversationSummary(conversationId: string): AssistantContextSummary | null {
  const row = db.prepare('SELECT summary, summary_source, summary_message_count FROM assistant_conversation_state WHERE conversation_id = ?').get(conversationId) as
    { summary: string | null; summary_source: string | null; summary_message_count: number } | undefined;
  if (!row || !row.summary) return null;
  return {
    summary: row.summary,
    source: row.summary_source === 'REAL_PROVIDER' ? 'REAL_PROVIDER' : 'DETERMINISTIC',
    messageCountSummarized: row.summary_message_count ?? 0,
  };
}

export function upsertConversationContext(conversationId: string, ctx: AssistantConversationContext): void {
  const cites = JSON.stringify(ctx.citationIds.slice(0, 50));
  const evs = JSON.stringify(ctx.evidenceIds.slice(0, 50));
  const ts = now();
  const exists = db.prepare('SELECT 1 FROM assistant_conversation_state WHERE conversation_id = ?').get(conversationId);
  if (exists) {
    db.prepare(
      `UPDATE assistant_conversation_state SET satellite_id = ?, investigation_id = ?, report_id = ?,
        planner_execution_id = ?, critic_execution_id = ?, citation_ids_json = ?, evidence_ids_json = ?,
        topic = ?, last_capability = ?, last_execution_mode = ?, updated_at = ? WHERE conversation_id = ?`,
    ).run(
      ctx.satelliteId, ctx.investigationId, ctx.reportId, ctx.plannerExecutionId, ctx.criticExecutionId,
      cites, evs, ctx.topic ? ctx.topic.slice(0, 200) : null, ctx.lastCapability, ctx.lastExecutionMode, ts, conversationId,
    );
  } else {
    db.prepare(
      `INSERT INTO assistant_conversation_state
        (conversation_id, satellite_id, investigation_id, report_id, planner_execution_id, critic_execution_id,
         citation_ids_json, evidence_ids_json, topic, last_capability, last_execution_mode,
         summary, summary_source, summary_message_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`,
    ).run(
      conversationId, ctx.satelliteId, ctx.investigationId, ctx.reportId, ctx.plannerExecutionId, ctx.criticExecutionId,
      cites, evs, ctx.topic ? ctx.topic.slice(0, 200) : null, ctx.lastCapability, ctx.lastExecutionMode, ts,
    );
  }
}

export function setConversationSummary(conversationId: string, summary: AssistantContextSummary): void {
  const bounded = summary.summary.slice(0, config.assistant.maxSummaryChars);
  const ts = now();
  const exists = db.prepare('SELECT 1 FROM assistant_conversation_state WHERE conversation_id = ?').get(conversationId);
  if (exists) {
    db.prepare('UPDATE assistant_conversation_state SET summary = ?, summary_source = ?, summary_message_count = ?, updated_at = ? WHERE conversation_id = ?')
      .run(bounded, summary.source, summary.messageCountSummarized, ts, conversationId);
  } else {
    db.prepare(
      `INSERT INTO assistant_conversation_state (conversation_id, summary, summary_source, summary_message_count, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(conversationId, bounded, summary.source, summary.messageCountSummarized, ts);
  }
}

// --- Executions ------------------------------------------------------------

export interface CreateAssistantExecution {
  correlation_id: string;
  conversation_id: string;
  message_id: number | null;
  user_id: string;
  execution_mode: string;
  status: string;
  intent: string;
  capability: string | null;
  provider: string | null;
  model: string | null;
  iteration_count: number;
  tool_call_count: number;
  retrieval_call_count: number;
  workflow_call_count: number;
  planner_execution_id: number | null;
  critic_execution_id: number | null;
  llm_execution_ids: number[];
  retrieval_execution_ids: number[];
  grounding_status: string | null;
  citation_count: number;
  evidence_count: number;
  context_resolved: boolean;
  quality_gate: string | null;
  average_grounding_support: number | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  answer_card_json: string | null;
  fallback_reason: string | null;
  failure_reason: string | null;
}

export function createAssistantExecution(rec: CreateAssistantExecution): number {
  const info = db.prepare(
    `INSERT INTO assistant_executions
      (correlation_id, conversation_id, message_id, user_id, execution_mode, status, intent, capability,
       provider, model, iteration_count, tool_call_count, retrieval_call_count, workflow_call_count,
       planner_execution_id, critic_execution_id, llm_execution_ids, retrieval_execution_ids, grounding_status,
       citation_count, evidence_count, context_resolved, quality_gate, average_grounding_support, latency_ms,
       input_tokens, output_tokens, answer_card_json, fallback_reason, failure_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rec.correlation_id, rec.conversation_id, rec.message_id, rec.user_id, rec.execution_mode, rec.status,
    rec.intent, rec.capability, rec.provider, rec.model, rec.iteration_count, rec.tool_call_count,
    rec.retrieval_call_count, rec.workflow_call_count, rec.planner_execution_id, rec.critic_execution_id,
    JSON.stringify(rec.llm_execution_ids), JSON.stringify(rec.retrieval_execution_ids), rec.grounding_status,
    rec.citation_count, rec.evidence_count, rec.context_resolved ? 1 : 0, rec.quality_gate,
    rec.average_grounding_support, rec.latency_ms, rec.input_tokens, rec.output_tokens, rec.answer_card_json,
    rec.fallback_reason, rec.failure_reason, now(),
  );
  return Number(info.lastInsertRowid);
}

export function getExecutionById(id: number) {
  return db.prepare('SELECT * FROM assistant_executions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

export function getExecutionByMessageId(messageId: number) {
  return db.prepare('SELECT * FROM assistant_executions WHERE message_id = ? ORDER BY id DESC LIMIT 1').get(messageId) as Record<string, unknown> | undefined;
}

// --- Feedback --------------------------------------------------------------

export function createFeedback(rec: {
  user_id: string; conversation_id: string; message_id: number; execution_id: number | null;
  rating: AssistantFeedbackRating; reason: AssistantFeedbackReason | null; comment: string | null;
}): AssistantFeedback {
  const info = db.prepare(
    `INSERT INTO assistant_feedback (user_id, conversation_id, message_id, execution_id, rating, reason, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rec.user_id, rec.conversation_id, rec.message_id, rec.execution_id, rec.rating, rec.reason,
    rec.comment ? rec.comment.slice(0, config.assistant.maxFeedbackCommentChars) : null, now());
  const id = Number(info.lastInsertRowid);
  return {
    id, userId: rec.user_id, conversationId: rec.conversation_id, messageId: rec.message_id,
    executionId: rec.execution_id, rating: rec.rating, reason: rec.reason,
    comment: rec.comment ?? null, createdAt: now(),
  };
}

export function latestFeedbackForMessage(messageId: number, userId: string) {
  return db.prepare('SELECT * FROM assistant_feedback WHERE message_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(messageId, userId) as Record<string, unknown> | undefined;
}
