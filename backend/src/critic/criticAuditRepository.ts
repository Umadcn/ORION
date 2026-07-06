/**
 * Critic audit repositories (Phase 7). Bounded summaries only — no raw prompts,
 * no hidden reasoning, no raw model responses, no raw vectors, no unrestricted
 * tool payloads, no secrets.
 */
import { db, now } from '../db.js';
import type { CriticReview, RevisionAttempt } from './types.js';

export interface CreateCriticExecution {
  correlation_id: string;
  investigation_id: number;
  planner_execution_id: number | null;
  user_id: string;
  execution_mode: string;
  review_version: string;
  critic_status: string;
  initial_decision: string;
  final_decision: string;
  issue_count: number;
  warning_count: number;
  error_count: number;
  critical_count: number;
  coverage_pass_count: number;
  coverage_fail_count: number;
  contradiction_count: number;
  revision_attempt_count: number;
  llm_execution_ids: number[];
  latency_ms: number;
  fallback_reason: string | null;
  failure_reason: string | null;
  human_review_required: boolean;
}

export function createCriticExecution(rec: CreateCriticExecution): number {
  const info = db
    .prepare(
      `INSERT INTO critic_executions
        (correlation_id, investigation_id, planner_execution_id, user_id, execution_mode, review_version,
         critic_status, initial_decision, final_decision, issue_count, warning_count, error_count, critical_count,
         coverage_pass_count, coverage_fail_count, contradiction_count, revision_attempt_count, llm_execution_ids_json,
         latency_ms, fallback_reason, failure_reason, human_review_required, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.correlation_id, rec.investigation_id, rec.planner_execution_id, rec.user_id, rec.execution_mode, rec.review_version,
      rec.critic_status, rec.initial_decision, rec.final_decision, rec.issue_count, rec.warning_count, rec.error_count, rec.critical_count,
      rec.coverage_pass_count, rec.coverage_fail_count, rec.contradiction_count, rec.revision_attempt_count, JSON.stringify(rec.llm_execution_ids),
      rec.latency_ms, rec.fallback_reason, rec.failure_reason, rec.human_review_required ? 1 : 0, now(),
    );
  return Number(info.lastInsertRowid);
}

/** Persist bounded per-issue summaries. `revisionAttempt` = 0 for the initial/final review. */
export function createCriticIssues(criticExecutionId: number, review: CriticReview, revisionAttempt: number, resolved: boolean): void {
  const stmt = db.prepare(
    `INSERT INTO critic_issues
      (critic_execution_id, issue_id, revision_attempt, severity, category, description_summary, claim_index,
       citation_ids_json, evidence_ids_json, recommended_correction_summary, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ts = now();
  for (const i of review.issues) {
    stmt.run(criticExecutionId, i.issue_id, revisionAttempt, i.severity, i.category, i.description.slice(0, 300), i.claim_index,
      JSON.stringify(i.citation_ids), JSON.stringify(i.evidence_ids), i.recommended_correction.slice(0, 300), resolved ? 1 : 0, ts);
  }
}

export function createCriticRevisionAttempts(criticExecutionId: number, attempts: RevisionAttempt[]): void {
  const stmt = db.prepare(
    `INSERT INTO critic_revision_attempts
      (critic_execution_id, attempt_number, input_analysis_hash, critique_hash, output_analysis_hash,
       validation_status, critic_decision_after, issue_count_after, latency_ms, failure_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ts = now();
  for (const a of attempts) {
    stmt.run(criticExecutionId, a.attemptNumber, a.inputAnalysisHash, a.critiqueHash, a.outputAnalysisHash,
      a.validationStatus, a.criticDecisionAfter, a.issueCountAfter, a.latencyMs, a.failureReason, ts);
  }
}

export function getCriticExecution(id: number) {
  const execution = db.prepare('SELECT * FROM critic_executions WHERE id = ?').get(id);
  if (!execution) return undefined;
  const issues = db.prepare('SELECT * FROM critic_issues WHERE critic_execution_id = ? ORDER BY id').all(id);
  const revisionAttempts = db.prepare('SELECT * FROM critic_revision_attempts WHERE critic_execution_id = ? ORDER BY attempt_number').all(id);
  return { execution, issues, revisionAttempts };
}

export function listCriticExecutions(filters: { investigationId?: number; plannerExecutionId?: number; decision?: string; limit?: number; offset?: number }) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.investigationId !== undefined) { clauses.push('investigation_id = ?'); params.push(filters.investigationId); }
  if (filters.plannerExecutionId !== undefined) { clauses.push('planner_execution_id = ?'); params.push(filters.plannerExecutionId); }
  if (filters.decision) { clauses.push('final_decision = ?'); params.push(filters.decision); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 50), 200));
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM critic_executions ${where}`).get(...params) as { c: number }).c;
  const items = db.prepare(`SELECT * FROM critic_executions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, limit, offset, items };
}
