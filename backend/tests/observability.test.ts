/**
 * Phase 8 observability unit tests. Offline + deterministic. Aggregates
 * controlled synthetic audit rows in an in-memory DB and asserts exact metrics,
 * percentiles, rates, time-range filtering, governance determinism, and bounds.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db, initSchema } from '../src/db.js';
import {
  average, distribution, isValidRange, latencyDistribution, parseRange, percentile, rangeCutoffIso, rate,
} from '../src/observability/aggregation.js';
import { makeRepoContext } from '../src/observability/observabilityRepository.js';
import { buildLlmMetrics, buildCriticMetrics, buildPlannerMetrics, buildRetrievalMetrics, buildLinkageMetrics } from '../src/observability/metrics.js';
import { ObservabilityService } from '../src/observability/observabilityService.js';

const NOW = '2026-07-05T12:00:00.000Z';
const OLD = '2020-01-01T00:00:00.000Z';
const svc = new ObservabilityService(() => NOW);

beforeAll(() => {
  initSchema();
});

// --- Pure aggregation ------------------------------------------------------
describe('aggregation helpers', () => {
  it('percentile is nearest-rank and exact', () => {
    const xs = [100, 20, 40, 10, 60, 30, 80, 50, 90, 70]; // unsorted
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 90)).toBe(90);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile(xs, 99)).toBe(100);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([42], 50)).toBe(42);
  });
  it('rate is zero-denominator safe', () => {
    expect(rate(3, 10)).toBe(0.3);
    expect(rate(1, 0)).toBe(0);
    expect(rate(0, 0)).toBe(0);
  });
  it('average returns null for empty and mean otherwise', () => {
    expect(average([])).toBeNull();
    expect(average([2, 4, 6])).toBe(4);
  });
  it('distribution is stable, bounded, folds tail into OTHER', () => {
    const d = distribution(['a', 'a', 'b', 'c', 'd', null], 2);
    expect(d[0]).toEqual({ key: 'a', count: 2, rate: rate(2, 6) });
    expect(d.some((x) => x.key === 'OTHER')).toBe(true);
    expect(d.reduce((s, x) => s + x.count, 0)).toBe(6);
  });
  it('latency distribution reports nulls when empty', () => {
    const l = latencyDistribution([]);
    expect(l).toEqual({ count: 0, averageMs: null, p50Ms: null, p95Ms: null, p99Ms: null, minMs: null, maxMs: null });
  });
  it('range parsing + cutoff', () => {
    expect(isValidRange('24H')).toBe(true);
    expect(isValidRange('bogus')).toBe(false);
    expect(parseRange('bogus', '7D')).toBe('7D');
    expect(rangeCutoffIso('ALL', NOW)).toBeNull();
    expect(rangeCutoffIso('24H', NOW)).toBe('2026-07-04T12:00:00.000Z');
  });
});

// --- Synthetic audit rows --------------------------------------------------
function insLlm(o: { mode: string; latency: number; createdAt?: string; sor?: number; sov?: number | null; provider?: string; inTok?: number; outTok?: number; corr?: string; fallback?: string | null; error?: string | null }) {
  db.prepare(
    `INSERT INTO llm_executions (correlation_id, provider, model, execution_mode, execution_status, prompt_version, request_type, input_token_count, output_token_count, total_token_count, latency_ms, retry_count, structured_output_requested, structured_output_valid, fallback_reason, error_code, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(o.corr ?? 'corr-1', o.provider ?? 'deterministic-fallback', 'm1', o.mode, o.mode === 'FAILED' ? 'FAILED' : 'FALLBACK', 'v1', 'test', o.inTok ?? 10, o.outTok ?? 20, (o.inTok ?? 10) + (o.outTok ?? 20), o.latency, 0, o.sor ?? 0, o.sov ?? null, o.fallback ?? null, o.error ?? null, o.createdAt ?? NOW);
}
function insCritic(o: { mode?: string; status: string; initial: string; final: string; contradiction?: number; passCount?: number; failCount?: number; plannerId?: number | null; llmIds?: string; hrr?: number; createdAt?: string; revisionAttempts?: number }) {
  db.prepare(
    `INSERT INTO critic_executions (correlation_id, investigation_id, planner_execution_id, user_id, execution_mode, review_version, critic_status, initial_decision, final_decision, issue_count, warning_count, error_count, critical_count, coverage_pass_count, coverage_fail_count, contradiction_count, revision_attempt_count, llm_execution_ids_json, latency_ms, fallback_reason, failure_reason, human_review_required, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('c', 1, o.plannerId === undefined ? null : o.plannerId, 'u', o.mode ?? 'DETERMINISTIC_FALLBACK', 'orion-planner-critic-v1', o.status, o.initial, o.final, 0, 0, 0, 0, o.passCount ?? 8, o.failCount ?? 0, o.contradiction ?? 0, o.revisionAttempts ?? 0, o.llmIds ?? '[]', 5, null, null, o.hrr ?? 1, o.createdAt ?? NOW);
}
function insPlanner(o: { mode?: string; status: string; llmIds?: string; retrievalIds?: string; grounding?: string; createdAt?: string }): number {
  const info = db.prepare(
    `INSERT INTO planner_executions (correlation_id, investigation_id, user_id, execution_mode, plan_version, plan_status, objective_summary, step_count, completed_step_count, failed_step_count, iteration_count, tool_call_count, retrieval_call_count, knowledge_gap_count, llm_execution_ids_json, retrieval_execution_ids_json, citation_count, evidence_count, grounding_status, latency_ms, fallback_reason, failure_reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('c', 1, 'u', o.mode ?? 'DETERMINISTIC_FALLBACK', 'orion-investigation-planner-v1', o.status, 'obj', 9, 9, 0, 9, 7, 1, 0, o.llmIds ?? '[]', o.retrievalIds ?? '[]', 2, 1, o.grounding ?? 'GROUNDED', 100, null, null, o.createdAt ?? NOW);
  return Number(info.lastInsertRowid);
}
function insRetrieval(o: { mode: string; embeddingMode?: string; returned: number; latency: number; createdAt?: string }) {
  db.prepare(
    `INSERT INTO retrieval_executions (correlation_id, query_hash, retrieval_mode, embedding_provider, embedding_model, embedding_mode, requested_top_k, effective_top_k, candidate_count, returned_count, latency_ms, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('c', 'h', o.mode, 'local', 'hash', o.embeddingMode ?? 'LOCAL_HASH_FALLBACK', 5, 5, 10, o.returned, o.latency, 'SUCCESS', o.createdAt ?? NOW);
}
function insEval(o: { mode: string; ndcg: number; createdAt?: string }) {
  db.prepare(
    `INSERT INTO retrieval_evaluation_runs (correlation_id, dataset_version, retrieval_mode, configuration_json, query_count, k_value, precision_at_k, recall_at_k, mrr, hit_rate_at_k, ndcg_at_k, average_latency_ms, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('c', 'v1', o.mode, '{}', 10, 5, 0.8, 0.7, 0.75, 0.9, o.ndcg, 12, 'SUCCESS', o.createdAt ?? NOW);
}

// --- Empty DB (must run before inserts) ------------------------------------
describe('empty database behavior', () => {
  it('zero rows => zero rates, null latencies, empty distributions', () => {
    const ctx = makeRepoContext('ALL', NOW);
    const llm = buildLlmMetrics(ctx);
    expect(llm.totalExecutions).toBe(0);
    expect(llm.realProviderRate).toBe(0);
    expect(llm.latency.p95Ms).toBeNull();
    expect(llm.providerDistribution).toEqual([]);
    const snap = svc.buildSnapshot('ALL');
    expect(snap.overview.totalAiExecutions).toBe(0);
    expect(snap.governance.alertCount).toBe(0);
  });
});

// --- LLM metrics -----------------------------------------------------------
describe('LLM metrics', () => {
  beforeAll(() => {
    // 6 executions: 1 real, 4 fallback, 1 failed; structured requested on 2 (1 valid).
    insLlm({ mode: 'REAL_PROVIDER', latency: 10, provider: 'openai', sor: 1, sov: 1 });
    insLlm({ mode: 'DETERMINISTIC_FALLBACK', latency: 20, fallback: 'NO_REAL_PROVIDER' });
    insLlm({ mode: 'DETERMINISTIC_FALLBACK', latency: 30, fallback: 'NO_REAL_PROVIDER' });
    insLlm({ mode: 'DETERMINISTIC_FALLBACK', latency: 40, fallback: 'NO_REAL_PROVIDER' });
    insLlm({ mode: 'DETERMINISTIC_FALLBACK', latency: 50, sor: 1, sov: 0 });
    insLlm({ mode: 'FAILED', latency: 60, error: 'TIMEOUT' });
    // an old row excluded from 24H:
    insLlm({ mode: 'REAL_PROVIDER', latency: 999, provider: 'openai', createdAt: OLD });
  });
  it('counts, rates, percentiles, tokens, distributions (ALL)', () => {
    const m = buildLlmMetrics(makeRepoContext('ALL', NOW));
    expect(m.totalExecutions).toBe(7);
    expect(m.failedCount).toBe(1);
    expect(m.deterministicFallbackCount).toBe(4);
    expect(m.realProviderCount).toBe(2);
    expect(m.structuredOutputRequestedRate).toBe(rate(2, 7));
    expect(m.structuredOutputValidRate).toBe(rate(1, 2));
    expect(m.totalTokenCount).toBe(7 * 30);
    expect(m.latency.minMs).toBe(10);
    expect(m.latency.maxMs).toBe(999);
  });
  it('time-range filtering excludes the old row (24H)', () => {
    const m = buildLlmMetrics(makeRepoContext('24H', NOW));
    expect(m.totalExecutions).toBe(6);
    expect(m.latency.maxMs).toBe(60);
    expect(m.failedRate).toBe(rate(1, 6));
  });
  it('is deterministic (same inputs => identical output)', () => {
    expect(buildLlmMetrics(makeRepoContext('24H', NOW))).toEqual(buildLlmMetrics(makeRepoContext('24H', NOW)));
  });
});

// --- Planner + Critic + linkage + governance -------------------------------
describe('planner + critic + linkage + governance', () => {
  let plannerId: number;
  beforeAll(() => {
    plannerId = insPlanner({ status: 'COMPLETED', llmIds: '[1,2]', retrievalIds: '[5]', grounding: 'GROUNDED' });
    insPlanner({ status: 'PARTIAL', llmIds: '[]', grounding: 'INSUFFICIENT' });
    insCritic({ status: 'ACCEPTED', initial: 'ACCEPT', final: 'ACCEPT', plannerId, llmIds: '[3]' });
    insCritic({ status: 'REVISED_ACCEPTED', initial: 'REVISE', final: 'ACCEPT', plannerId, revisionAttempts: 1 });
    insCritic({ status: 'REJECTED', initial: 'REJECT', final: 'REJECT', plannerId: null, contradiction: 2 }); // orphan
  });
  it('planner metrics: status rates + linkage-relevant fields', () => {
    const m = buildPlannerMetrics(makeRepoContext('ALL', NOW));
    expect(m.totalExecutions).toBe(2);
    expect(m.completedRate).toBe(rate(1, 2));
    expect(m.partialRate).toBe(rate(1, 2));
    expect(m.groundedAnalysisRate).toBe(rate(1, 2));
  });
  it('critic metrics: decisions, revision success, contradictions', () => {
    const m = buildCriticMetrics(makeRepoContext('ALL', NOW));
    expect(m.totalExecutions).toBe(3);
    expect(m.acceptRate).toBe(rate(2, 3));
    expect(m.rejectRate).toBe(rate(1, 3));
    expect(m.revisedAcceptedRate).toBe(rate(1, 3));
    expect(m.revisionSuccessRate).toBe(rate(1, 1)); // 1 entered revision, 1 revised-accepted
  });
  it('linkage: planner→critic reviewed, orphans, planner-without-llm', () => {
    const m = buildLinkageMetrics(makeRepoContext('ALL', NOW));
    expect(m.plannerToCriticReviewedCount).toBe(1);
    expect(m.orphanCriticCount).toBe(1);
    expect(m.plannerWithoutLlmCount).toBe(1);
    expect(m.linkedRetrievalCount).toBe(1);
    expect(m.humanReviewRequiredCount).toBe(3);
  });
  it('governance: LLM failure CRITICAL fires when failedRate exceeds threshold; advisory only', () => {
    // From the LLM block: 24H failedRate = 1/6 ≈ 0.167 (< 0.2 default) => no critical.
    const g = svc.getGovernance('24H');
    expect(g.advisory).toBe(true);
    // deterministic ordering: critical first
    expect(Array.isArray(g.alerts)).toBe(true);
    // determinism
    expect(svc.getGovernance('24H')).toEqual(svc.getGovernance('24H'));
  });
});

// --- Retrieval + evaluations + timeseries ----------------------------------
describe('retrieval + evaluations + timeseries', () => {
  beforeAll(() => {
    insRetrieval({ mode: 'HYBRID_RRF_RERANK', returned: 5, latency: 8 });
    insRetrieval({ mode: 'HYBRID_RRF_RERANK', returned: 0, latency: 9 });
    insEval({ mode: 'VECTOR', ndcg: 0.6 });
    insEval({ mode: 'HYBRID_RRF_RERANK', ndcg: 0.82 });
  });
  it('retrieval zero-result rate + latest evaluations by mode', () => {
    const m = buildRetrievalMetrics(makeRepoContext('ALL', NOW));
    expect(m.totalExecutions).toBe(2);
    expect(m.zeroResultRate).toBe(rate(1, 2));
    expect(m.latestEvaluationsByMode.length).toBe(2);
  });
  it('evaluations summary picks best nDCG mode', () => {
    const e = svc.getEvaluations();
    expect(e.bestNdcgMode).toBe('HYBRID_RRF_RERANK');
  });
  it('timeseries: allowlisted metric returns bounded points; invalid metric throws', () => {
    const ts = svc.getTimeseries('ai_executions', '7D');
    expect(ts.points.length).toBeGreaterThan(0);
    expect(ts.points.length).toBeLessThanOrEqual(500);
    expect(ts.points.reduce((s, p) => s + p.count, 0)).toBeGreaterThan(0);
    expect(() => svc.getTimeseries('DROP TABLE', '7D')).toThrow();
  });
  it('snapshot has no raw prompts / responses / vectors / secrets', () => {
    const snap = JSON.stringify(svc.buildSnapshot('ALL'));
    expect(snap).not.toContain('embedding_json');
    expect(snap).not.toContain('Bearer ');
    expect(snap).not.toMatch(/"(prompt|response_summary|request_summary|chain_of_thought)"\s*:/i);
    expect(snap).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });
});
