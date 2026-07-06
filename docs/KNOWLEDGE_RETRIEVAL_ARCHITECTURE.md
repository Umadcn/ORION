# Knowledge & Retrieval Architecture (Phase 2)

> **Phase 3 update:** vector retrieval described here remains the default and is
> unchanged. Phase 3 adds BM25 + hybrid (RRF) + deterministic reranking + a
> retrieval-quality evaluation harness on top of it — see
> `docs/HYBRID_RETRIEVAL_ARCHITECTURE.md` and `docs/RETRIEVAL_EVALUATION.md`.

How the Mission Knowledge Base ingests documents, embeds them, stores vectors,
and retrieves them — all **offline-first** and **auditable**. This document is
the authoritative statement of what Phase 2 is and, importantly, what it is not.

## Honest labeling — read this first

- **LocalHashEmbedding is deterministic lexical feature hashing, NOT a neural
  semantic embedding model.** It is not a transformer, not sentence-transformers,
  not OpenAI embeddings, and not any ML model. It hashes lowercased unigrams and
  adjacent bigrams into a fixed-dimension vector with signed accumulation and L2
  normalization. It **always** reports the execution mode `LOCAL_HASH_FALLBACK`
  and is never represented as `REAL_EMBEDDING_PROVIDER`.
- **SQLite vector scanning is appropriate for the current demo corpus.** It is an
  in-process, bounded cosine-similarity scan. It is intentionally replaceable:
  anything satisfying the `VectorStore` interface (e.g. a dedicated vector DB)
  can be dropped in without changing ingestion or retrieval.
- **Retrieval similarity is NOT confidence.** Cosine similarity is a
  lexical/vector relevance score for ranking only. It is never an LLM confidence
  and is never converted into root-cause confidence. The API echoes this in
  every search response (`similarityDisclaimer`).
- **Phase 2 does not generate answers.** There is no RAG answer generation, no
  LLM wiring into agents, no reranking, no hybrid BM25 fusion, and no copilot.
  Phase 2 delivers retrieval + citations only.

## Pipeline

```
document (plain text)
  → validate + bound (size, batch, metadata)
  → normalize (NFC, LF, strip control chars, collapse whitespace, keep numbers/units)
  → content hash (SHA-256 of normalized text)
  → deterministic chunking (paragraph-aware, bounded, overlap, stable IDs)
  → embed each chunk (EmbeddingProvider; default LocalHashEmbedding)
  → store transactionally (knowledge_documents + knowledge_chunks + vectors)

query
  → validate + normalize + bound
  → embed query (same provider/space)
  → validate dimension + finiteness
  → apply whitelisted metadata filters
  → load bounded candidates → cosine similarity → stable sort → enforce topK
  → attach stable citations + provenance
  → persist retrieval audit
  → return normalized response (with similarity disclaimer)
```

## Normalization rules

Deterministic and idempotent. Unifies line endings to LF, normalizes Unicode to
NFC, removes invalid C0 control characters (TAB and LF preserved), collapses
runs of intra-line whitespace to a single space, collapses 3+ newlines to a
single blank line (paragraph boundary), and trims document edges. It never
strips mission-relevant numbers, units, identifiers, or punctuation — only
whitespace and invalid control characters are touched. Identical logical content
always yields an identical hash.

## Chunking rules

Paragraph-aware, character-windowed, and loop-safe. The walker prefers to break
at a paragraph boundary, then a line break, then a word boundary, and hard-cuts
only when necessary. Chunk size and overlap are validated and clamped (overlap
is forced below chunk size; position strictly increases every iteration, so it
cannot loop). A too-small trailing chunk is folded into its predecessor. Chunk
IDs (`<STABLE_ID>#<index>`) and citation IDs are stable across restarts and
identical re-ingestion because they depend only on the stable document ID and
chunk index — never on a database auto-increment ID.

## Embedding provider abstraction

`EmbeddingProvider` exposes name, model, version, mode, dimension, max input
size, availability, and `embedText`/`embedBatch`. Execution modes:

- `REAL_EMBEDDING_PROVIDER` — a configured external model produced the vector.
- `LOCAL_HASH_FALLBACK` — LocalHashEmbedding produced the vector (the default).
- `FAILED` — the vector could not be produced.

`resolveEmbeddingProvider()` picks the real HTTP provider only when fully
configured via `ORION_EMBEDDING_*`; otherwise it returns LocalHashEmbedding. A
single provider instance is used for both ingestion and query within a run so
stored and query vectors share one space and dimension. Real and fallback
vectors are never silently mixed in one store.

> **Note on switching to a real embedding provider:** the seeded corpus is
> embedded offline with LocalHashEmbedding. If you later configure a real
> embedding provider, re-ingest documents so all vectors share the same space.

## Vector store design

`SQLiteVectorStore` stores each chunk's vector as a compact JSON array in
`knowledge_chunks.embedding_json`. Retrieval loads a bounded set of candidate
chunks (metadata filters applied via parameterized column equalities — no SQL
injection surface), validates the query vector dimension and finiteness, rejects
NaN/Infinity, computes cosine similarity, and sorts deterministically:
`similarity desc`, then `document_id asc`, then `chunk_index asc` for stable
tie-breaking. `topK` is clamped to the configured maximum.

## Citation design

Format: `ORION-KB-<STABLE_DOCUMENT_ID>-C<0000>`. Deterministic, URL/API-safe, and
resolvable back to the exact stored chunk via `GET /api/knowledge/citations/:id`.
Every retrieval result and citation lookup carries provenance (origin, opaque
source label, document version, ingested-by, ingested-at). `sourceUri` is an
**opaque provenance label only** — it is stored, never fetched or dereferenced.

## Auditability

Every retrieval writes a `retrieval_executions` row: correlation ID, query hash,
sanitized+truncated query summary (secrets redacted), retrieval mode, embedding
provider/model/mode, requested vs effective topK, filters, candidate/returned
counts, latency, status, and sanitized error. No secrets and no Authorization
headers are ever stored.

## Data & network boundaries

- No network is required for startup, tests, seed ingestion, embedding, or
  retrieval under the default configuration.
- No arbitrary filesystem-path ingestion, no URL fetching, no remote downloads,
  no shell/executable document processing, no HTML/script execution.
- Plain-text/JSON mission-document ingestion only; binary PDF/DOCX upload is out
  of scope for Phase 2.
- Every loop, ingestion size, chunk count, retrieval limit, and request body is
  bounded.
