/**
 * Retrieval evaluation service (Phase 3).
 *
 * Runs the synthetic benchmark against the seeded corpus for a given retrieval
 * mode, computes per-query + aggregate ranking metrics, and (optionally)
 * persists the run. Fully offline + deterministic. No LLM, no network.
 *
 * It reports ACTUAL MEASURED metrics — it never assumes hybrid retrieval is
 * better than any other mode.
 */
import crypto from 'node:crypto';
import { config, redactSecrets } from '../config.js';
import { retrieve } from '../knowledge/retrievalService.js';
import { evaluationRepo } from '../knowledge/repository.js';
import { RERANKER_VERSION } from './reranker.js';
import { averageMetrics, computeMetrics } from './metrics.js';
import { EVALUATION_DATASET_VERSION, getEvaluationDataset } from './evaluationDataset.js';
import { RETRIEVAL_MODES } from '../knowledge/types.js';
import type { RetrievalMode } from '../knowledge/types.js';
import type { EvaluationMetrics, EvaluationRun, PerQueryEvaluationResult } from './types.js';

export interface RunEvaluationOptions {
  mode: RetrievalMode;
  k?: number;
  createdBy?: string | null;
  persist?: boolean;
}

/** De-duplicate returned document IDs, preserving first-seen rank order. */
function dedupeDocs(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function configurationSnapshot(mode: RetrievalMode, k: number): Record<string, unknown> {
  const r = config.retrieval;
  return {
    mode, k,
    datasetVersion: EVALUATION_DATASET_VERSION,
    vectorCandidates: r.vectorCandidates,
    bm25Candidates: r.bm25Candidates,
    fusionK: r.fusionK,
    rerankCandidates: r.rerankCandidates,
    bm25K1: r.bm25K1,
    bm25B: r.bm25B,
    rerankerVersion: mode === 'HYBRID_RRF_RERANK' ? RERANKER_VERSION : null,
    embeddingDimension: config.embedding.dimension,
  };
}

/** Run the benchmark for one retrieval mode. */
export async function runEvaluation(opts: RunEvaluationOptions): Promise<EvaluationRun> {
  const mode = opts.mode;
  const k = Math.max(1, Math.min(Math.floor(opts.k ?? config.retrieval.defaultTopK), config.retrieval.maxTopK));
  const correlationId = crypto.randomUUID();
  const dataset = getEvaluationDataset();
  const queries = dataset.queries.slice(0, config.retrieval.evalMaxQueries);

  const perQuery: PerQueryEvaluationResult[] = [];
  const metricsList: EvaluationMetrics[] = [];
  let totalLatency = 0;

  try {
    for (const q of queries) {
      const started = Date.now();
      const result = await retrieve({
        query: q.query,
        filters: q.filters,
        topK: k,
        mode,
        createdBy: opts.createdBy ?? null,
      });
      const latency = Date.now() - started;
      totalLatency += latency;

      const returnedDocumentIds = dedupeDocs(result.items.map((i) => i.stableDocumentId));
      const gains = q.judgments && q.judgments.length
        ? new Map(q.judgments.map((j) => [j.stableDocumentId, j.relevance ?? 1]))
        : undefined;
      const metrics = computeMetrics({ returnedIds: returnedDocumentIds, relevantIds: q.relevantDocumentIds, k, gains });
      metricsList.push(metrics);
      perQuery.push({
        queryId: q.queryId, mode, returnedDocumentIds,
        relevantDocumentIds: q.relevantDocumentIds, metrics, latencyMs: latency,
      });
    }

    const aggregate = averageMetrics(metricsList, k);
    const averageLatencyMs = queries.length ? Number((totalLatency / queries.length).toFixed(3)) : 0;
    const configuration = configurationSnapshot(mode, k);

    const run: EvaluationRun = {
      correlationId, datasetVersion: dataset.version, mode, k, queryCount: queries.length,
      metrics: aggregate, perQuery, averageLatencyMs, configuration,
      status: 'SUCCESS', errorCode: null, sanitizedErrorMessage: null,
    };

    if (opts.persist) persistRun(run, opts.createdBy ?? null);
    return run;
  } catch (err) {
    const message = err instanceof Error ? redactSecrets(err.message).slice(0, 300) : 'Evaluation failed';
    const run: EvaluationRun = {
      correlationId, datasetVersion: dataset.version, mode, k, queryCount: queries.length,
      metrics: { k, precisionAtK: 0, recallAtK: 0, mrr: 0, hitRateAtK: 0, ndcgAtK: 0 },
      perQuery, averageLatencyMs: 0, configuration: configurationSnapshot(mode, k),
      status: 'FAILED', errorCode: 'EVALUATION_ERROR', sanitizedErrorMessage: message,
    };
    if (opts.persist) persistRun(run, opts.createdBy ?? null);
    return run;
  }
}

/** Run the benchmark across all four modes and return measured comparisons. */
export async function compareModes(k?: number, createdBy?: string | null, persist = false): Promise<EvaluationRun[]> {
  const runs: EvaluationRun[] = [];
  for (const mode of RETRIEVAL_MODES) {
    runs.push(await runEvaluation({ mode, k, createdBy, persist }));
  }
  return runs;
}

function persistRun(run: EvaluationRun, createdBy: string | null): number {
  return evaluationRepo.create({
    correlation_id: run.correlationId,
    dataset_version: run.datasetVersion,
    retrieval_mode: run.mode,
    configuration_json: JSON.stringify(run.configuration),
    query_count: run.queryCount,
    k_value: run.k,
    precision_at_k: run.metrics.precisionAtK,
    recall_at_k: run.metrics.recallAtK,
    mrr: run.metrics.mrr,
    hit_rate_at_k: run.metrics.hitRateAtK,
    ndcg_at_k: run.metrics.ndcgAtK,
    average_latency_ms: run.averageLatencyMs,
    status: run.status,
    error_code: run.errorCode,
    sanitized_error_message: run.sanitizedErrorMessage,
    created_by: createdBy,
  });
}
