/**
 * Embedding-space registry + controlled corpus re-embedding (Phase 9).
 * Director/Admin, opt-in, bounded. NEVER runs at startup.
 *
 * Integrity guarantees:
 *  - one ACTIVE embedding space for standard retrieval;
 *  - re-embedding buffers ALL new vectors and validates them BEFORE writing, so
 *    the previous active space is never destroyed on partial failure;
 *  - activation is atomic; a failed re-index leaves the previous space usable;
 *  - content, citation IDs, chunk indices, and provenance are preserved exactly;
 *  - no mixed-space retrieval.
 */
import crypto from 'node:crypto';
import { config, redactSecrets } from '../config.js';
import { resolveEmbeddingProvider } from '../embeddings/index.js';
import { assertFiniteVector, type EmbeddingProvider } from '../embeddings/provider.js';
import { documentRepo, chunkRepo, type ChunkEmbeddingInfo } from '../knowledge/repository.js';
import type { ProducedChunk } from '../knowledge/types.js';
import { spaceIdentityFromProvider, deriveSpaceKey, spaceKeyFromChunkColumns, type EmbeddingSpaceIdentity } from './embeddingSpace.js';
import {
  activateEmbeddingSpace, createReindex, getActiveSpaceKey, getEmbeddingSpace, listEmbeddingSpaces,
  updateReindex, upsertEmbeddingSpace,
} from './providerRepository.js';

export interface ActiveSpaceInfo {
  spaceKey: string;
  identity: EmbeddingSpaceIdentity;
  persisted: boolean;
  isFallback: boolean;
}

/** Identity of the provider that WOULD be used for new embeddings right now. */
export function currentProviderIdentity(): { provider: EmbeddingProvider; identity: EmbeddingSpaceIdentity; isFallback: boolean } {
  const { provider, isFallback } = resolveEmbeddingProvider();
  return { provider, identity: spaceIdentityFromProvider(provider, config.providers.embeddingNormalizationPolicy), isFallback };
}

/**
 * The effective active embedding space: the persisted ACTIVE space if present,
 * otherwise (backward-compatible) the space of the currently-resolved provider.
 */
export function effectiveActiveSpace(): ActiveSpaceInfo {
  const persistedKey = getActiveSpaceKey();
  const cur = currentProviderIdentity();
  if (persistedKey) {
    const row = getEmbeddingSpace(persistedKey);
    if (row) {
      return {
        spaceKey: persistedKey,
        identity: { provider: String(row.provider), model: String(row.model), version: String(row.version), dimension: Number(row.dimension), normalizationPolicy: String(row.normalization_policy) },
        persisted: true,
        isFallback: cur.isFallback,
      };
    }
  }
  return { spaceKey: deriveSpaceKey(cur.identity), identity: cur.identity, persisted: false, isFallback: cur.isFallback };
}

export function listSpaces() {
  return listEmbeddingSpaces();
}

/** Distinct embedding spaces observed across stored chunks (mismatch detection). */
export function chunkSpaceStats(): { spaceKey: string; provider: string; model: string; dimension: number; chunkCount: number }[] {
  return chunkRepo.distinctSpaceStats().map((r) => ({
    spaceKey: r.space_key ?? spaceKeyFromChunkColumns(r),
    provider: r.embedding_provider,
    model: r.embedding_model,
    dimension: r.embedding_dimension,
    chunkCount: r.chunk_count,
  }));
}

export interface ReindexResult {
  reindexId: number;
  status: 'COMPLETED' | 'FAILED';
  sourceSpaceKey: string | null;
  targetSpaceKey: string;
  totalDocuments: number;
  processedDocuments: number;
  totalChunks: number;
  processedChunks: number;
  failedDocuments: number;
  sanitizedErrorMessage: string | null;
}

/**
 * Re-embed the entire READY corpus into the current provider's embedding space,
 * then atomically activate it. Buffers + validates before any write.
 */
export async function reindexCorpus(params: { userId: string | null }): Promise<ReindexResult> {
  const correlationId = crypto.randomUUID();
  const { provider, identity } = currentProviderIdentity();
  const targetSpaceKey = deriveSpaceKey(identity);
  const sourceSpaceKey = getActiveSpaceKey();

  const docs = documentRepo.list({ status: 'READY', limit: 1000, offset: 0 }).items;
  let totalChunks = 0;
  const perDoc = docs.map((d) => {
    const chunks = chunkRepo.listByDocument(d.id, 500, 0).items;
    totalChunks += chunks.length;
    return { doc: d, chunks };
  });

  const reindexId = createReindex({ correlation_id: correlationId, source_space_key: sourceSpaceKey, target_space_key: targetSpaceKey, total_documents: docs.length, total_chunks: totalChunks, created_by: params.userId });

  const embeddingInfo: ChunkEmbeddingInfo = { provider: provider.name, model: provider.model, mode: provider.mode, version: provider.version, dimension: provider.dimension() };
  const batchSize = config.providers.reindexBatchSize;

  // --- Phase 1: compute + validate ALL vectors in memory (no writes yet). ---
  const buffered: { documentId: number; produced: ProducedChunk[]; vectors: number[][]; metadataJson: string }[] = [];
  let processedDocuments = 0;
  let processedChunks = 0;
  let failedDocuments = 0;

  try {
    for (const { doc, chunks } of perDoc) {
      if (chunks.length === 0) { processedDocuments++; continue; }
      const produced: ProducedChunk[] = chunks.map((c) => ({
        stableChunkId: c.stable_chunk_id, chunkIndex: c.chunk_index, citationId: c.citation_id, content: c.content,
        contentHash: c.content_hash, startOffset: c.start_offset ?? 0, endOffset: c.end_offset ?? 0, tokenCountEstimate: c.token_count_estimate ?? 0,
      }));
      const vectors: number[][] = [];
      for (let i = 0; i < produced.length; i += batchSize) {
        const slice = produced.slice(i, i + batchSize).map((p) => p.content);
        const vecs = await provider.embedBatch(slice);
        for (const v of vecs) assertFiniteVector(v, provider.dimension());
        vectors.push(...vecs);
        processedChunks += vecs.length;
      }
      buffered.push({ documentId: doc.id, produced, vectors, metadataJson: chunks[0].metadata_json });
      processedDocuments++;
      updateReindex(reindexId, { processed_documents: processedDocuments, processed_chunks: processedChunks });
    }
  } catch (err) {
    failedDocuments = docs.length - processedDocuments;
    const msg = redactSecrets((err as Error).message).slice(0, 300);
    updateReindex(reindexId, { status: 'FAILED', processed_documents: processedDocuments, processed_chunks: processedChunks, failed_documents: failedDocuments, completed_at: new Date().toISOString(), sanitized_error_message: msg });
    // Previous active space is untouched (no writes happened).
    return { reindexId, status: 'FAILED', sourceSpaceKey, targetSpaceKey, totalDocuments: docs.length, processedDocuments, totalChunks, processedChunks, failedDocuments, sanitizedErrorMessage: msg };
  }

  // --- Phase 2: VALIDATING → write all buffered vectors, register + activate. ---
  updateReindex(reindexId, { status: 'VALIDATING' });
  try {
    for (const b of buffered) {
      chunkRepo.replaceChunksForDocument(b.documentId, b.produced, b.vectors, embeddingInfo, b.metadataJson);
      chunkRepo.setSpaceKeyForDocument(b.documentId, targetSpaceKey);
    }
    upsertEmbeddingSpace({ space_key: targetSpaceKey, provider: identity.provider, model: identity.model, version: identity.version, dimension: identity.dimension, normalization_policy: identity.normalizationPolicy, status: 'COMPLETED', document_count: docs.length, chunk_count: totalChunks });
    activateEmbeddingSpace(targetSpaceKey);
    updateReindex(reindexId, { status: 'COMPLETED', completed_at: new Date().toISOString() });
    return { reindexId, status: 'COMPLETED', sourceSpaceKey, targetSpaceKey, totalDocuments: docs.length, processedDocuments, totalChunks, processedChunks, failedDocuments: 0, sanitizedErrorMessage: null };
  } catch (err) {
    const msg = redactSecrets((err as Error).message).slice(0, 300);
    updateReindex(reindexId, { status: 'FAILED', completed_at: new Date().toISOString(), sanitized_error_message: msg });
    return { reindexId, status: 'FAILED', sourceSpaceKey, targetSpaceKey, totalDocuments: docs.length, processedDocuments, totalChunks, processedChunks, failedDocuments, sanitizedErrorMessage: msg };
  }
}
