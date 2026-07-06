/**
 * Exact citation / source inspection (Phase 10). Reuses the Phase 2/3
 * resolveCitation seam. Returns a bounded, sanitized source reference:
 * document title/version/provenance + an exact bounded excerpt + embedding
 * space identity (safe). NEVER returns raw vectors, filesystem paths, secrets,
 * hidden prompts, or unrelated chunks.
 */
import { config, redactSecrets } from '../config.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import { isValidCitationId } from '../knowledge/citations.js';
import { documentRepo } from '../knowledge/repository.js';
import type { AssistantSourceReference } from './types.js';

const EXCERPT_MAX = 600;

export function buildSourceReference(citationId: string): AssistantSourceReference | null {
  if (typeof citationId !== 'string' || !isValidCitationId(citationId)) return null;
  const r = resolveCitation(citationId);
  if (!r) return null;
  const { chunk, citation, document } = r;
  const excerpt = redactSecrets((chunk.content ?? '').replace(/\s+/g, ' ').trim()).slice(0, EXCERPT_MAX);
  return {
    citationId,
    documentId: document.id,
    documentTitle: citation.title,
    documentStableId: document.stable_document_id ?? null,
    documentVersion: document.document_version ?? null,
    sourceType: document.source_type ?? null,
    provenanceOrigin: document.provenance_origin ?? null,
    ingestedBy: document.created_by ?? null,
    ingestedAt: document.created_at ?? null,
    chunkIndex: chunk.chunk_index,
    excerpt,
    embeddingSpaceKey: chunk.embedding_space_key ?? null,
    embeddingProvider: chunk.embedding_provider ?? null,
    embeddingModel: chunk.embedding_model ?? null,
  };
}

/** Read-only knowledge document metadata (no filesystem paths, no raw vectors, no content dump). */
export function documentMetadata(documentId: number): Record<string, unknown> | null {
  const id = Math.floor(Number(documentId));
  if (!Number.isFinite(id)) return null;
  const doc = documentRepo.getById(id);
  if (!doc) return null;
  return {
    documentId: doc.id,
    stableDocumentId: doc.stable_document_id,
    title: doc.title,
    sourceType: doc.source_type,
    classification: doc.classification,
    subsystem: doc.subsystem,
    satelliteId: doc.satellite_id,
    anomalyType: doc.anomaly_type,
    documentVersion: doc.document_version,
    provenanceOrigin: doc.provenance_origin,
    ingestedBy: doc.created_by,
    ingestedAt: doc.created_at,
    chunkCount: doc.chunk_count,
    charCount: Math.min(doc.char_count, config.assistant.maxContextChars),
    status: doc.status,
  };
}
