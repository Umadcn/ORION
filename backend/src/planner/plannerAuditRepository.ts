/**
 * Planner audit repositories (Phase 6). Bounded summaries only — no raw prompts,
 * no hidden reasoning, no raw embeddings, no secrets, no unrestricted payloads.
 */
import { db, now } from '../db.js';
import type { PlanStepResult, RetrievalRefinement } from './types.js';

export interface CreatePlannerExecution {
  correlation_id: string; investigation_id: number; user_id: string; execution_mode: string;
  plan_version: string; plan_status: string; objective_summary: string | null;
  step_count: number; completed_step_count: number; failed_step_count: number; iteration_count: number;
  tool_call_count: number; retrieval_call_count: number; knowledge_gap_count: number;
  llm_execution_ids: number[]; retrieval_execution_ids: number[]; citation_count: number; evidence_count: number;
  grounding_status: string | null; latency_ms: number; fallback_reason: string | null; failure_reason: string | null;
}

export function createPlannerExecution(rec: CreatePlannerExecution): number {
  const info = db
    .prepare(
      `INSERT INTO planner_executions
        (correlation_id, investigation_id, user_id, execution_mode, plan_version, plan_status, objective_summary,
         step_count, completed_step_count, failed_step_count, iteration_count, tool_call_count, retrieval_call_count,
         knowledge_gap_count, llm_execution_ids_json, retrieval_execution_ids_json, citation_count, evidence_count,
         grounding_status, latency_ms, fallback_reason, failure_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.correlation_id, rec.investigation_id, rec.user_id, rec.execution_mode, rec.plan_version, rec.plan_status,
      rec.objective_summary, rec.step_count, rec.completed_step_count, rec.failed_step_count, rec.iteration_count,
      rec.tool_call_count, rec.retrieval_call_count, rec.knowledge_gap_count, JSON.stringify(rec.llm_execution_ids),
      JSON.stringify(rec.retrieval_execution_ids), rec.citation_count, rec.evidence_count, rec.grounding_status,
      rec.latency_ms, rec.fallback_reason, rec.failure_reason, now(),
    );
  return Number(info.lastInsertRowid);
}

export function createStepExecutions(plannerExecutionId: number, steps: PlanStepResult[]): void {
  const stmt = db.prepare(
    `INSERT INTO planner_step_executions
      (planner_execution_id, step_id, step_type, step_order, status, dependency_ids_json, tool_name,
       tool_execution_id, retrieval_execution_id, input_summary, output_summary, latency_ms, error_code,
       sanitized_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ts = now();
  for (const s of steps) {
    stmt.run(plannerExecutionId, s.stepId, s.stepType, s.order, s.status, null, s.toolName, s.toolExecutionId,
      s.retrievalExecutionId, s.inputSummary.slice(0, 300), s.outputSummary.slice(0, 500), s.latencyMs, s.errorCode, s.sanitizedError, ts);
  }
}

export function createRefinements(plannerExecutionId: number, refs: RetrievalRefinement[]): void {
  const stmt = db.prepare(
    `INSERT INTO planner_retrieval_refinements
      (planner_execution_id, iteration, gap_type, query_hash, sanitized_query_summary, retrieval_execution_id,
       result_count, new_citation_count, sufficiency_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ts = now();
  for (const r of refs) {
    stmt.run(plannerExecutionId, r.iteration, r.gapType, r.queryHash, r.querySummary.slice(0, 160), r.retrievalExecutionId, r.resultCount, r.newCitationCount, r.sufficiencyAfter ? 'SUFFICIENT' : 'INSUFFICIENT', ts);
  }
}

export function getPlannerExecution(id: number) {
  const exec = db.prepare('SELECT * FROM planner_executions WHERE id = ?').get(id);
  if (!exec) return undefined;
  const steps = db.prepare('SELECT * FROM planner_step_executions WHERE planner_execution_id = ? ORDER BY step_order').all(id);
  const refinements = db.prepare('SELECT * FROM planner_retrieval_refinements WHERE planner_execution_id = ? ORDER BY iteration').all(id);
  return { execution: exec, steps, refinements };
}

export function listPlannerExecutions(filters: { investigationId?: number; status?: string; limit?: number; offset?: number }) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.investigationId !== undefined) { clauses.push('investigation_id = ?'); params.push(filters.investigationId); }
  if (filters.status) { clauses.push('plan_status = ?'); params.push(filters.status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 50), 200));
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM planner_executions ${where}`).get(...params) as { c: number }).c;
  const items = db.prepare(`SELECT * FROM planner_executions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, limit, offset, items };
}
