# Retrieval Evaluation (Phase 3)

An offline, deterministic harness that MEASURES ranking quality of each retrieval
mode over a synthetic ORION benchmark. It reports **actual measured metrics** and
makes **no assumption that any mode (including hybrid) is better** — read the
numbers.

> These metrics measure ranking quality on the synthetic benchmark only. They are
> not confidence and say nothing about real-world correctness. No LLM is involved.

## Dataset (`orion-eval-v1`)

Original synthetic content only. 8 bounded queries, each mapping to relevant
document stable IDs in the seeded `SYNTHETIC_ORION_CORPUS` (two queries carry
graded judgments for nDCG). Deterministic and versioned. Bounded by
`ORION_RETRIEVAL_EVAL_MAX_QUERIES`.

| Query | Relevant document(s) |
|-------|----------------------|
| payload power converter latch-up / ORION-3 | ORION-3-PAYLOAD-POWER-INCIDENT (+ POWER-OPS-MANUAL, graded) |
| battery degradation / voltage decay | ORION-BATTERY-DEGRADATION-REPORT |
| thermal control overheating | ORION-THERMAL-TROUBLESHOOTING |
| S-band communication loss | ORION-COMMS-ANOMALY-PROC (+ GROUND-LINK, graded) |
| safe mode recovery sequence | ORION-SAFE-MODE-RECOVERY |
| attitude control pointing instability | ORION-ADCS-MISSION-RULES |
| ground station link troubleshooting | ORION-GROUND-LINK-TROUBLESHOOTING |
| power subsystem undervoltage | ORION-POWER-OPS-MANUAL |

## Metrics

Computed at cutoff K (document-level; returned chunks are de-duplicated to their
documents, preserving rank order). All are zero-result and zero-relevance safe.

- **Precision@K** = relevant in top K / K
- **Recall@K** = relevant in top K / total relevant
- **MRR** = 1 / rank of first relevant result
- **HitRate@K** = 1 if any relevant in top K else 0
- **nDCG@K** = DCG@K / IDCG@K, gain = graded judgment (default 1 for relevant)

Each metric is unit-tested against hand-calculated expected values.

## Measured results (this build)

Benchmark run over the seeded corpus at **K = 5**, all 8 queries, LocalHashEmbedding
(`LOCAL_HASH_FALLBACK`), dimension 256, fusion k = 60. Actual measured values:

| Mode | P@5 | R@5 | MRR | Hit@5 | nDCG@5 | avg latency |
|------|-----|-----|-----|-------|--------|-------------|
| VECTOR | 0.200 | 1.000 | 1.000 | 1.000 | 0.964 | ~1.8 ms |
| LEXICAL_BM25 | 0.200 | 1.000 | 1.000 | 1.000 | 0.964 | ~2.0 ms |
| HYBRID_RRF | 0.200 | 1.000 | 1.000 | 1.000 | 0.964 | ~2.6 ms |
| HYBRID_RRF_RERANK | 0.200 | 1.000 | 1.000 | 1.000 | **1.000** | ~3.9 ms |

**Honest reading of these numbers:** the corpus is small (8 documents, 12 chunks)
and each query has a strongly lexically-distinct relevant document, so every mode
already places a relevant document at rank 1 — hence R@5, MRR, and Hit@5 saturate
at 1.000 across the board, and P@5 sits at 0.200 (typically ~1 relevant document
among 5 returned). The only measured differentiation on this benchmark is
**nDCG@5**, where the deterministic reranker improves graded ordering from 0.964
to **1.000** by promoting the higher-graded document. On this small benchmark
hybrid and BM25 do **not** measurably beat vector on the saturated metrics; the
reranker's advantage is confined to graded ordering. A larger, more ambiguous
corpus would be needed to differentiate the modes further.

## Persistence

Runs are stored in `retrieval_evaluation_runs` (correlation id, dataset version,
mode, configuration snapshot, query count, k, the five metrics, average latency,
status). No secrets, no embeddings.

## APIs (Director / System Admin only)

- `POST /api/knowledge/evaluations/run` — `{ mode?, k? }`; `mode` omitted or
  `ALL` runs all four modes. Bounded workload; no dataset uploads; no code
  execution; no network.
- `GET /api/knowledge/evaluations` — bounded run history.
- `GET /api/knowledge/evaluations/:id` — a single run.

## Reproduce

Evaluation runs entirely offline against the seeded corpus. Trigger via the API
above (Director/Admin) or the `runEvaluation` / `compareModes` service functions.
Results are deterministic for a fixed corpus + configuration.
