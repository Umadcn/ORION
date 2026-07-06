/**
 * Retrieval quality metrics. Pure, deterministic, and zero-result/zero-relevance
 * safe. All metrics measure RANKING QUALITY on the synthetic benchmark only —
 * they are not confidence and say nothing about real-world correctness.
 *
 *   Precision@K = (# relevant in top K) / K
 *   Recall@K    = (# relevant in top K) / (total # relevant)      [0 if none relevant]
 *   MRR         = 1 / rank of first relevant result               [0 if none found]
 *   HitRate@K   = 1 if any relevant in top K else 0
 *   nDCG@K      = DCG@K / IDCG@K, gain = graded judgment (default 1 for relevant)
 *
 * `returnedIds` must already be de-duplicated to the unit of relevance (document
 * stable IDs), preserving rank order.
 */
import type { EvaluationMetrics } from './types.js';

export interface MetricInput {
  returnedIds: string[];
  relevantIds: string[];
  k: number;
  /** Optional graded gains by document id (defaults to 1 for relevant ids). */
  gains?: Map<string, number>;
}

export function computeMetrics(input: MetricInput): EvaluationMetrics {
  const k = Math.max(1, Math.floor(input.k));
  const relevant = new Set(input.relevantIds);
  const topK = input.returnedIds.slice(0, k);

  const hitsInTopK = topK.reduce((n, id) => n + (relevant.has(id) ? 1 : 0), 0);
  const precisionAtK = hitsInTopK / k;
  const recallAtK = relevant.size > 0 ? hitsInTopK / relevant.size : 0;
  const hitRateAtK = hitsInTopK > 0 ? 1 : 0;

  // MRR over the full returned list.
  let mrr = 0;
  for (let i = 0; i < input.returnedIds.length; i++) {
    if (relevant.has(input.returnedIds[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  const ndcgAtK = computeNdcg(topK, relevant, input.gains, k);

  return {
    k,
    precisionAtK: round(precisionAtK),
    recallAtK: round(recallAtK),
    mrr: round(mrr),
    hitRateAtK: round(hitRateAtK),
    ndcgAtK: round(ndcgAtK),
  };
}

function gainOf(id: string, relevant: Set<string>, gains?: Map<string, number>): number {
  if (gains && gains.has(id)) return Math.max(0, gains.get(id)!);
  return relevant.has(id) ? 1 : 0;
}

function computeNdcg(topK: string[], relevant: Set<string>, gains: Map<string, number> | undefined, k: number): number {
  // DCG over the actual ranking.
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const g = gainOf(topK[i], relevant, gains);
    if (g > 0) dcg += g / Math.log2(i + 2); // rank i+1 -> log2(rank+1)
  }
  // Ideal DCG: best-possible ordering of all relevant gains, truncated to k.
  const idealGains: number[] = [];
  if (gains && gains.size > 0) {
    for (const g of gains.values()) if (g > 0) idealGains.push(g);
  } else {
    for (let i = 0; i < relevant.size; i++) idealGains.push(1);
  }
  idealGains.sort((a, b) => b - a);
  let idcg = 0;
  for (let i = 0; i < Math.min(idealGains.length, k); i++) {
    idcg += idealGains[i] / Math.log2(i + 2);
  }
  return idcg > 0 ? dcg / idcg : 0;
}

/** Macro-average a set of metric objects (all sharing the same k). */
export function averageMetrics(metrics: EvaluationMetrics[], k: number): EvaluationMetrics {
  if (metrics.length === 0) {
    return { k, precisionAtK: 0, recallAtK: 0, mrr: 0, hitRateAtK: 0, ndcgAtK: 0 };
  }
  const sum = metrics.reduce(
    (acc, m) => ({
      precisionAtK: acc.precisionAtK + m.precisionAtK,
      recallAtK: acc.recallAtK + m.recallAtK,
      mrr: acc.mrr + m.mrr,
      hitRateAtK: acc.hitRateAtK + m.hitRateAtK,
      ndcgAtK: acc.ndcgAtK + m.ndcgAtK,
    }),
    { precisionAtK: 0, recallAtK: 0, mrr: 0, hitRateAtK: 0, ndcgAtK: 0 },
  );
  const n = metrics.length;
  return {
    k,
    precisionAtK: round(sum.precisionAtK / n),
    recallAtK: round(sum.recallAtK / n),
    mrr: round(sum.mrr / n),
    hitRateAtK: round(sum.hitRateAtK / n),
    ndcgAtK: round(sum.ndcgAtK / n),
  };
}

function round(n: number): number {
  return Number(n.toFixed(6));
}
