/**
 * Copilot audit repositories (Phase 5): per-tool execution audit +
 * per-message copilot execution audit. No secrets, no raw payloads.
 */
import { db, now } from '../db.js';

export interface CreateToolExecution {
  correlation_id: string;
  conversation_id: string;
  message_id: number | null;
  tool_call_id: string;
  tool_name: string;
  tool_version: string;
  execution_mode: string;
  input_summary: string | null;
  output_summary: string | null;
  status: string;
  validation_status: string;
  latency_ms: number;
  error_code: string | null;
  sanitized_error: string | null;
}

export function createToolExecution(rec: CreateToolExecution): number {
  const info = db
    .prepare(
      `INSERT INTO copilot_tool_executions
        (correlation_id, conversation_id, message_id, tool_call_id, tool_name, tool_version,
         execution_mode, input_summary, output_summary, status, validation_status, latency_ms,
         error_code, sanitized_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.correlation_id, rec.conversation_id, rec.message_id, rec.tool_call_id, rec.tool_name,
      rec.tool_version, rec.execution_mode, rec.input_summary, rec.output_summary, rec.status,
      rec.validation_status, rec.latency_ms, rec.error_code, rec.sanitized_error, now(),
    );
  return Number(info.lastInsertRowid);
}

export interface CreateCopilotExecution {
  correlation_id: string;
  conversation_id: string;
  message_id: number | null;
  user_id: string;
  execution_mode: string;
  provider: string | null;
  model: string | null;
  iteration_count: number;
  tool_call_count: number;
  retrieval_execution_ids: number[];
  llm_execution_ids: number[];
  generation_status: string | null;
  grounding_status: string | null;
  citation_count: number;
  evidence_count: number;
  latency_ms: number;
  fallback_reason: string | null;
  failure_reason: string | null;
}

export function createCopilotExecution(rec: CreateCopilotExecution): number {
  const info = db
    .prepare(
      `INSERT INTO copilot_executions
        (correlation_id, conversation_id, message_id, user_id, execution_mode, provider, model,
         iteration_count, tool_call_count, retrieval_execution_ids, llm_execution_ids, generation_status,
         grounding_status, citation_count, evidence_count, latency_ms, fallback_reason, failure_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.correlation_id, rec.conversation_id, rec.message_id, rec.user_id, rec.execution_mode, rec.provider,
      rec.model, rec.iteration_count, rec.tool_call_count, JSON.stringify(rec.retrieval_execution_ids),
      JSON.stringify(rec.llm_execution_ids), rec.generation_status, rec.grounding_status, rec.citation_count,
      rec.evidence_count, rec.latency_ms, rec.fallback_reason, rec.failure_reason, now(),
    );
  return Number(info.lastInsertRowid);
}

export function listToolExecutions(correlationId: string) {
  return db.prepare('SELECT * FROM copilot_tool_executions WHERE correlation_id = ? ORDER BY id').all(correlationId);
}
