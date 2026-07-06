/**
 * VectorStore abstraction + SQLiteVectorStore implementation.
 *
 * SQLiteVectorStore performs an in-process, bounded cosine-similarity scan over
 * chunk vectors stored in the knowledge_chunks table. This is appropriate for
 * the current demo corpus and is intentionally replaceable: any backend that
 * satisfies the VectorStore interface (e.g. a dedicated vector database) can be
 * dropped in without touching the ingestion or retrieval services.
 *
 * No external vector database, no network. Query vectors are validated for
 * dimension and finiteness; NaN/Infinity are rejected. Ranking is deterministic
 * with stable tie-breaking.
 */
import { config } from '../config.js';
import { assertFiniteVector, cosineSimilarity } from '../embeddings/provider.js';
import { spaceKeyFromChunkColumns } from '../providers/embeddingSpace.js';
import { chunkRepo, type ChunkCandidate } from './repository.js';
import type { KnowledgeChunk, ProducedChunk, RetrievalFilter } from './types.js';
import type { ChunkEmbeddingInfo } from './repository.js';

export interface ScoredChunk {
  chunk: KnowledgeChunk;
  similarity: number;
}

export interface VectorStore {
  upsertChunks(
    documentId: number,
    chunks: ProducedChunk[],
    vectors: number[][],
    embedding: ChunkEmbeddingInfo,
    metadataJson: string,
  ): void;
  deleteChunksForDocument(documentId: number): void;
  getByCitationId(citationId: string): KnowledgeChunk | undefined;
  retrieve(queryVector: number[], filters: RetrievalFilter, topK: number, expectedSpaceKey?: string | null): {
    items: ScoredChunk[];
    candidateCount: number;
    spaceMismatchCount: number;
  };
}

export class SQLiteVectorStore implements VectorStore {
  upsertChunks(
    documentId: number,
    chunks: ProducedChunk[],
    vectors: number[][],
    embedding: ChunkEmbeddingInfo,
    metadataJson: string,
  ): void {
    chunkRepo.replaceChunksForDocument(documentId, chunks, vectors, embedding, metadataJson);
  }

  deleteChunksForDocument(documentId: number): void {
    chunkRepo.deleteChunksForDocument(documentId);
  }

  getByCitationId(citationId: string): KnowledgeChunk | undefined {
    return chunkRepo.getByCitationId(citationId);
  }

  retrieve(queryVector: number[], filters: RetrievalFilter, topK: number, expectedSpaceKey?: string | null): { items: ScoredChunk[]; candidateCount: number; spaceMismatchCount: number } {
    // Validate the query vector up front (dimension enforced against candidates).
    assertFiniteVector(queryVector);

    const candidates: ChunkCandidate[] = chunkRepo.loadCandidates(
      {
        sourceType: filters.sourceType,
        subsystem: filters.subsystem,
        satelliteId: filters.satelliteId,
        anomalyType: filters.anomalyType,
        classification: filters.classification,
      },
      config.retrieval.maxCandidates,
    );

    let spaceMismatchCount = 0;
    const scored: ScoredChunk[] = [];
    for (const cand of candidates) {
      // Phase 9: when an active embedding space is provided, fail closed on any
      // candidate from a different space (never mix incomparable vector spaces).
      if (expectedSpaceKey) {
        const candSpaceKey = cand.embedding_space_key ?? spaceKeyFromChunkColumns({
          embedding_provider: cand.embedding_provider, embedding_model: cand.embedding_model,
          embedding_version: cand.embedding_version, embedding_dimension: cand.embedding_dimension,
        });
        if (candSpaceKey !== expectedSpaceKey) { spaceMismatchCount++; continue; }
      }
      // Dimension mismatch between the query and a stored vector is skipped
      // (defensive — occurs only if the embedding provider/dimension changed
      // after ingestion). The retrieval service validates the primary path.
      if (cand.vector.length !== queryVector.length) continue;
      let finite = true;
      for (const v of cand.vector) {
        if (typeof v !== 'number' || !Number.isFinite(v)) { finite = false; break; }
      }
      if (!finite) continue;
      const similarity = cosineSimilarity(queryVector, cand.vector);
      // Strip the parsed vector from the returned chunk to keep payloads lean.
      const { vector: _v, ...chunk } = cand;
      scored.push({ chunk: chunk as KnowledgeChunk, similarity });
    }

    // Deterministic ranking: similarity desc, then stable tie-break by
    // (document_id asc, chunk_index asc) via stable_chunk_id.
    scored.sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      if (a.chunk.document_id !== b.chunk.document_id) return a.chunk.document_id - b.chunk.document_id;
      return a.chunk.chunk_index - b.chunk.chunk_index;
    });

    const bounded = Math.max(1, Math.min(topK, config.retrieval.maxTopK));
    return { items: scored.slice(0, bounded), candidateCount: candidates.length, spaceMismatchCount };
  }
}

export const vectorStore: VectorStore = new SQLiteVectorStore();
