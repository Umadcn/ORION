# Hybrid Retrieval Architecture (Phase 3)

Upgrades ORION retrieval from vector-only to an offline-first, auditable hybrid
pipeline: **BM25 + vector**, fused with **Reciprocal Rank Fusion (RRF)**, with an
optional **deterministic reranker**, plus a retrieval-quality **evaluation
harness**. Phase 2 vector retrieval is preserved unchanged and remains the
default.

## Honest labeling — read this first

- **LocalHashEmbedding is deterministic lexical feature hashing, NOT a neural
  semantic embedding model.** It always reports `LOCAL_HASH_FALLBACK`.
- **No score is a confidence.** Cosine similarity, BM25 score, RRF score, and
  rerank score are all ranking signals. None is an LLM confidence or an RCA
  confidence. The API echoes the disclaimer in every search response.
- **Retrieval metrics measure ranking quality on the synthetic benchmark only.**
  They say nothing about real-world correctness.
- **No LLM-generated answers exist in Phase 3.** No agent uses `LlmRunner`. No
  copilot, no RAG answer generation, no reflection/planner/critic loops.

## Modes

| Mode | Pipeline | Embedding? |
|------|----------|-----------|
| `VECTOR` (default) | cosine over LocalHashEmbedding vectors | yes |
| `LEXICAL_BM25` | BM25 only | **no** (never generates an embedding) |
| `HYBRID_RRF` | vector + BM25 → RRF | yes |
| `HYBRID_RRF_RERANK` | vector + BM25 → RRF → deterministic rerank | yes |

`VECTOR` maps to the audited execution descriptor `VECTOR_COSINE` for backward
compatibility. When `mode` is omitted, `config.retrieval.defaultMode` (VECTOR)
is used, producing the exact Phase 2 response shape plus diagnostics.

## Flow (HYBRID_RRF_RERANK)

```
query → validate + normalize → metadata filters
      → query embedding → bounded vector candidates
      → bounded BM25 candidates
      → Reciprocal Rank Fusion (rank-based)
      → select bounded rerank set → deterministic rerank
      → stable final sort → enforce topK
      → citations + provenance → diagnostics → audit → response
```

`LEXICAL_BM25` skips embedding generation entirely.

## Tokenizer

Deterministic, ORION-specific: NFC-normalized, lowercased, split on whitespace
and non-identifier separators while **preserving mission identifiers and units**
as single tokens — `ORION-3`, `PAYLOAD_POWER`, `28V`, `BATTERY-2`, `SAFE_MODE`,
`S-BAND`. Minimal mission-safe stopword list (never removes numbers, units, or
identifiers); no stemming (which would corrupt identifiers). Token counts are
bounded. The reranker additionally expands identifier tokens into subtokens
(`BATTERY_DEGRADATION` → `battery`, `degradation`) for metadata matching, so
natural-language queries can match structured metadata.

## BM25

Lucene-style, non-negative IDF:

```
score(D,Q) = Σ_{t∈Q} IDF(t) · ( f(t,D)·(k1+1) ) / ( f(t,D) + k1·(1 - b + b·|D|/avgdl) )
IDF(t)     = ln( 1 + (N - n_t + 0.5) / (n_t + 0.5) )
```

Configurable `k1` (default 1.2) and `b` (default 0.75). Zero-match chunks are
excluded; scores are finite; ranking is deterministic with stable tie-breaking
(score desc → document_id asc → chunk_index asc).

**Index lifecycle:** the index is built **per query** from a bounded candidate
set loaded from the current database (metadata filters applied before scoring).
There is intentionally **no persistent global index**, so results are always
consistent with the current corpus — newly ingested, re-ingested, or archived
documents are reflected immediately with zero stale-index risk. Empty corpus and
empty query are handled safely.

## Reciprocal Rank Fusion

```
RRF(d) = Σ_i 1 / (k + rank_i(d))      (rank starts at 1; k configurable, default 60)
```

Rank-based fusion — BM25 scores are **never** normalized against cosine
similarities. A document present in one list contributes only that term.
Duplicates are eliminated by chunk id; per-source contributions (vectorRank,
vectorSimilarity, bm25Rank, bm25Score) are preserved. Deterministic with stable
tie-breaking (rrfScore desc → document_id asc → chunk_index asc).

## Deterministic reranker (`orion-deterministic-reranker-v1`)

No LLM, no model, no network. Additive, explainable signals over a bounded fused
candidate set:

```
rerankScore(d) = W_RRF·rrfScore(d)
               + W_SAT ·[satelliteId token in query]
               + W_SUB ·[subsystem (sub)token in query]
               + W_ANOM·[anomalyType (sub)token in query]
               + W_TITLE·titleOverlapRatio(d)
               + W_CHUNK·chunkOverlapRatio(d)
               + W_PHRASE·[normalized query is a substring of the chunk]
               + W_AGREE·[present in BOTH vector and BM25 lists]
```

Weights: RRF 1.0, SAT 0.6, SUB 0.4, ANOM 0.4, TITLE 0.5, CHUNK 0.3, PHRASE 0.5,
AGREE 0.3. It returns `rerankScore` + an explainable `scoreBreakdown` **separately**
— it never overwrites the raw vector/BM25/RRF scores. Deterministic with stable
tie-breaking (rerankScore desc → rrfScore desc → document_id asc → chunk_index asc).

## Diagnostics

Every search response includes a bounded, secret-free `diagnostics` object: mode,
normalized query summary, query token count, candidate counts (vector/bm25/fused/
reranked), returned count, embedding provider/model/mode + `embeddingUsed`,
fusion k, reranker version, filters applied, and latency. Per-result fields:
`finalRank`, `vectorRank`, `vectorSimilarity`, `bm25Rank`, `bm25Score`,
`rrfScore`, `rerankScore`, `matchedTerms`, and `scoreBreakdown` (when reranked).
No secrets, no Authorization headers, no raw embedding vectors, no unrestricted
raw query text (summaries are redacted + truncated).

## Audit

`retrieval_executions` is extended (additive, nullable columns; older rows remain
readable) with `vector_candidate_count`, `bm25_candidate_count`,
`fused_candidate_count`, `reranked_candidate_count`, `fusion_k`,
`reranker_version`, `evaluation_run_id`. A safe idempotent migration adds these
columns to pre-Phase-3 databases.

## Configuration

`ORION_RETRIEVAL_DEFAULT_MODE`, `_VECTOR_CANDIDATES`, `_BM25_CANDIDATES`,
`_FUSION_K`, `_RERANK_CANDIDATES`, `_BM25_K1`, `_BM25_B`, `_MAX_QUERY_TOKENS`,
`_EVAL_MAX_QUERIES` — all bounds-validated with safe offline defaults. Exposed
(sanitized) via `GET /api/knowledge/status`.

## APIs

- `POST /api/knowledge/search` — now accepts `mode` (backward compatible).
- `POST /api/knowledge/evaluations/run` — run the benchmark (Director/Admin);
  `mode` omitted or `ALL` runs all four modes; bounded workload, no uploads.
- `GET /api/knowledge/evaluations` / `:id` — evaluation history (Director/Admin).

See `docs/RETRIEVAL_EVALUATION.md` for the benchmark, metrics, and measured results.
