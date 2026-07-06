# Embedding-Space Migration (Phase 9)

An **embedding space** is the `(provider, model, version, dimension,
normalizationPolicy)` tuple a vector belongs to. Vectors from different spaces are
NOT comparable and must never be mixed in one retrieval space. This is the most
important Phase 9 integrity guarantee.

## Space identity + key

`EmbeddingSpaceIdentity` → deterministic `space_key`
`provider:model:version:dimension:normalizationPolicy` (`src/providers/embeddingSpace.ts`).
Each stored chunk carries an `embedding_space_key` (Phase 9 additive column; NULL
pre-Phase-9 rows derive their key from their embedding columns).

## Registry + active space

- `embedding_spaces` — one row per known space (PENDING/COMPLETED/ACTIVE/INACTIVE,
  provider/model/version/dimension/normalization, document + chunk counts).
- The single ACTIVE space key is stored in `system_settings`
  (`active_embedding_space_key`). `effectiveActiveSpace()` returns the persisted
  ACTIVE space, or (backward-compatible) the current provider's space when none is
  persisted.
- Only ONE space is ACTIVE for standard retrieval. Activation is atomic
  (`activateEmbeddingSpace`: demote previous ACTIVE + set new + update setting, in
  a transaction).

## Controlled re-embedding workflow

`POST /api/providers/embeddings/reindex` (Director/Admin, opt-in, NEVER at
startup). `reindexCorpus` (`src/providers/embeddingSpaceService.ts`):

1. Resolve the current provider → target space identity + key.
2. Load all READY documents + their chunks.
3. **Phase 1 — compute + validate:** re-embed every chunk's content in bounded
   batches, validating dimension + finiteness. Buffer ALL new vectors in memory.
   Any failure aborts here with **no writes** — the previous active space is
   untouched and remains fully usable.
4. **Phase 2 — VALIDATING → write + activate:** write all buffered vectors
   (content, citation IDs, chunk indices, provenance preserved EXACTLY), tag each
   chunk with the target `space_key`, upsert the space as COMPLETED, then
   atomically activate it.

Lifecycle: `RUNNING → VALIDATING → COMPLETED` (or `FAILED`). Progress is tracked
in `embedding_reindex_executions` (processed/total documents + chunks, failed
documents, sanitized error). Idempotent: re-running with the same provider
produces the same space key and same deterministic vectors (for LocalHash).

## Retrieval integration (fail-closed)

`VECTOR`/`HYBRID` retrieval:
- computes the query provider's space key;
- if a persisted ACTIVE space exists and the query space ≠ active space →
  **fail closed** (`RetrievalSpaceMismatchError` → HTTP 409, audited as
  `EMBEDDING_SPACE_MISMATCH`);
- filters candidate vectors to the active space (`spaceMismatchCount` diagnostic);
- `LEXICAL_BM25` needs no embeddings and is always available.

Retrieval diagnostics expose the sanitized `embeddingSpaceKey`, `embeddingMode`,
`embeddingDimension`, and `spaceMismatchCount`. Raw vectors are never exposed.
Similarity remains a ranking signal — never confidence.

## Guarantees

Old embeddings are not destroyed until the new space is fully computed +
validated; activation is atomic; a failed re-index leaves the previous space
usable; citation IDs / provenance are stable; retrieval never mixes spaces.
