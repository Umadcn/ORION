/**
 * Read-only observability repository (Phase 8).
 *
 * Aggregates the EXISTING Phase 1–7 audit tables. Parameterized SQL only. Table
 * names come from a fixed internal allowlist (never user input); there is NO
 * arbitrary table/column selection and NO new event pipeline. Row fetches are
 * bounded by `ORION_OBSERVABILITY_MAX_ROWS`. `now` is injected for deterministic
 * tests.
 */
import { db, now as dbNow } from '../db.js';
import { config } from '../config.js';
import { rangeCutoffIso } from './aggregation.js';
import type { ObservabilityTimeRange } from './types.js';

/** Fixed allowlist of audit tables this subsystem may read (defense-in-depth). */
const ALLOWED_TABLES = new Set([
  'llm_executions', 'retrieval_executions', 'retrieval_evaluation_runs',
  'grounded_generation_executions', 'copilot_conversations', 'copilot_messages',
  'copilot_executions', 'copilot_tool_executions', 'planner_executions',
  'planner_step_executions', 'planner_retrieval_refinements', 'critic_executions',
  'critic_issues', 'critic_revision_attempts',
  // Phase 9 provider audit tables (read-only aggregation).
  'provider_verification_executions', 'embedding_reindex_executions', 'provider_comparison_runs', 'provider_comparison_results',
  // Phase 10 assistant audit tables (read-only aggregation).
  'assistant_executions', 'assistant_feedback', 'assistant_eval_runs', 'assistant_eval_results',
]);

export interface RepoContext {
  range: ObservabilityTimeRange;
  cutoffIso: string | null;
  maxRows: number;
}

export function makeRepoContext(range: ObservabilityTimeRange, nowIso?: string): RepoContext {
  return { range, cutoffIso: rangeCutoffIso(range, nowIso ?? dbNow()), maxRows: config.observability.maxRows };
}

/** Rows from an allowlisted table within the range, bounded, newest-first. */
export function fetchRows(table: string, ctx: RepoContext): Record<string, unknown>[] {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`observability: table not allowlisted: ${table}`);
  if (ctx.cutoffIso === null) {
    return db.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ?`).all(ctx.maxRows) as Record<string, unknown>[];
  }
  return db.prepare(`SELECT * FROM ${table} WHERE created_at >= ? ORDER BY id DESC LIMIT ?`).all(ctx.cutoffIso, ctx.maxRows) as Record<string, unknown>[];
}

/** Exact COUNT(*) within range (not bounded by maxRows). */
export function countRows(table: string, ctx: RepoContext): number {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`observability: table not allowlisted: ${table}`);
  if (ctx.cutoffIso === null) return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE created_at >= ?`).get(ctx.cutoffIso) as { c: number }).c;
}

/** Distinct non-null count of a column within range (parameterized). */
export function distinctCount(table: string, column: string, ctx: RepoContext): number {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`observability: table not allowlisted: ${table}`);
  const COLS: Record<string, string[]> = {
    llm_executions: ['correlation_id'],
    critic_executions: ['planner_execution_id'],
  };
  if (!COLS[table]?.includes(column)) throw new Error(`observability: column not allowlisted: ${table}.${column}`);
  if (ctx.cutoffIso === null) return (db.prepare(`SELECT COUNT(DISTINCT ${column}) AS c FROM ${table} WHERE ${column} IS NOT NULL`).get() as { c: number }).c;
  return (db.prepare(`SELECT COUNT(DISTINCT ${column}) AS c FROM ${table} WHERE ${column} IS NOT NULL AND created_at >= ?`).get(ctx.cutoffIso) as { c: number }).c;
}

/** Number helper: coerce a possibly-null SQL numeric to a JS number (NaN-safe). */
export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a JSON-array column (e.g. llm_execution_ids_json) to a length, safely. */
export function jsonArrayLength(v: unknown): number {
  if (typeof v !== 'string' || !v) return 0;
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}
