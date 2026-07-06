/**
 * Phase 3 retrieval evaluation tests: metrics (hand-calculated), dataset, and
 * the evaluation service across all four modes. Fully offline + deterministic.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema } from '../src/db.js';
import { seedKnowledgeIfEmpty } from '../src/knowledge/seed.js';
import { computeMetrics, averageMetrics } from '../src/retrieval/metrics.js';
import { getEvaluationDataset, EVALUATION_DATASET_VERSION } from '../src/retrieval/evaluationDataset.js';
import { runEvaluation, compareModes } from '../src/retrieval/evaluationService.js';
import { evaluationRepo } from '../src/knowledge/repository.js';
import { RETRIEVAL_MODES } from '../src/knowledge/types.js';

beforeAll(() => {
  initSchema();
  seedKnowledgeIfEmpty();
});

// --------------------------------------------------------------------------
// Metrics — hand-calculated (43-49)
// --------------------------------------------------------------------------
describe('metrics', () => {
  it('43-47. computes precision/recall/mrr/hitrate/ndcg with known values', () => {
    const m = computeMetrics({ returnedIds: ['A', 'B', 'C', 'D'], relevantIds: ['B', 'D'], k: 2 });
    expect(m.precisionAtK).toBeCloseTo(0.5, 6); // 1 relevant in top2 / 2
    expect(m.recallAtK).toBeCloseTo(0.5, 6); // 1 of 2 relevant
    expect(m.mrr).toBeCloseTo(0.5, 6); // first relevant (B) at rank 2
    expect(m.hitRateAtK).toBe(1);
    // DCG = 1/log2(3); IDCG = 1/log2(2) + 1/log2(3)
    const dcg = 1 / Math.log2(3);
    const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
    expect(m.ndcgAtK).toBeCloseTo(dcg / idcg, 6);
  });
  it('47. nDCG rewards better ordering with graded gains', () => {
    const gains = new Map([['X', 2], ['Y', 1]]);
    const perfect = computeMetrics({ returnedIds: ['X', 'Y'], relevantIds: ['X', 'Y'], k: 2, gains });
    const worse = computeMetrics({ returnedIds: ['Y', 'X'], relevantIds: ['X', 'Y'], k: 2, gains });
    expect(perfect.ndcgAtK).toBeCloseTo(1, 6);
    expect(worse.ndcgAtK).toBeLessThan(perfect.ndcgAtK);
  });
  it('48. is zero-result safe', () => {
    const m = computeMetrics({ returnedIds: [], relevantIds: ['A'], k: 3 });
    expect(m).toMatchObject({ precisionAtK: 0, recallAtK: 0, mrr: 0, hitRateAtK: 0, ndcgAtK: 0 });
  });
  it('49. is zero-relevance safe (no divide-by-zero)', () => {
    const m = computeMetrics({ returnedIds: ['A', 'B'], relevantIds: [], k: 3 });
    expect(m.recallAtK).toBe(0);
    expect(Number.isFinite(m.ndcgAtK)).toBe(true);
    expect(m.ndcgAtK).toBe(0);
  });
  it('averages metrics correctly', () => {
    const avg = averageMetrics(
      [
        { k: 3, precisionAtK: 1, recallAtK: 1, mrr: 1, hitRateAtK: 1, ndcgAtK: 1 },
        { k: 3, precisionAtK: 0, recallAtK: 0, mrr: 0, hitRateAtK: 0, ndcgAtK: 0 },
      ],
      3,
    );
    expect(avg.precisionAtK).toBeCloseTo(0.5, 6);
  });
});

// --------------------------------------------------------------------------
// Dataset (41,42)
// --------------------------------------------------------------------------
describe('evaluation dataset', () => {
  it('41. is deterministic and versioned', () => {
    const a = getEvaluationDataset();
    const b = getEvaluationDataset();
    expect(a).toEqual(b);
    expect(a.version).toBe(EVALUATION_DATASET_VERSION);
  });
  it('42. is bounded and canonicalizes relevant doc IDs', () => {
    const ds = getEvaluationDataset();
    expect(ds.queries.length).toBeGreaterThan(0);
    expect(ds.queries.length).toBeLessThanOrEqual(50);
    for (const q of ds.queries) {
      for (const id of q.relevantDocumentIds) expect(id).toBe(id.toUpperCase());
    }
  });
});

// --------------------------------------------------------------------------
// Evaluation service (50-55)
// --------------------------------------------------------------------------
describe('evaluation service', () => {
  it('50-53. runs each mode and produces sane measured metrics', async () => {
    for (const mode of RETRIEVAL_MODES) {
      const run = await runEvaluation({ mode, k: 3 });
      expect(run.status).toBe('SUCCESS');
      expect(run.queryCount).toBe(getEvaluationDataset().queries.length);
      expect(run.perQuery.length).toBe(run.queryCount);
      for (const v of [run.metrics.precisionAtK, run.metrics.recallAtK, run.metrics.mrr, run.metrics.hitRateAtK, run.metrics.ndcgAtK]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
  it('54. compares all modes with measured metrics (no assumption hybrid wins)', async () => {
    const runs = await compareModes(3);
    expect(runs.map((r) => r.mode).sort()).toEqual([...RETRIEVAL_MODES].sort());
    // Each run reports its own measured hit rate; we assert they exist, not ordering.
    for (const r of runs) expect(typeof r.metrics.hitRateAtK).toBe('number');
  });
  it('55. persists an evaluation run and reads it back', async () => {
    const before = evaluationRepo.list({ limit: 1 }).total;
    await runEvaluation({ mode: 'HYBRID_RRF', k: 3, createdBy: 'tester', persist: true });
    const after = evaluationRepo.list({ limit: 1 });
    expect(after.total).toBe(before + 1);
    const rec = evaluationRepo.getById(after.items[0].id)!;
    expect(rec.retrieval_mode).toBe('HYBRID_RRF');
    expect(rec.dataset_version).toBe(EVALUATION_DATASET_VERSION);
    expect(rec.status).toBe('SUCCESS');
    // No secrets in the stored configuration snapshot.
    expect(rec.configuration_json).not.toContain('Bearer ');
  });
});
