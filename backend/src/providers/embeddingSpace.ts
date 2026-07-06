/**
 * Embedding-space identity (Phase 9).
 *
 * An embedding space is the (provider, model, version, dimension,
 * normalizationPolicy) tuple that a vector belongs to. Vectors from different
 * spaces are NOT comparable and must never be mixed in one retrieval space.
 * Retrieval fails closed on a space mismatch. The `space_key` is a stable,
 * deterministic string derived from the identity.
 */
import type { EmbeddingProvider } from '../embeddings/provider.js';

export interface EmbeddingSpaceIdentity {
  provider: string;
  model: string;
  version: string;
  dimension: number;
  normalizationPolicy: string;
}

function sanitize(part: string): string {
  return String(part).replace(/[^A-Za-z0-9_.-]+/g, '_');
}

/** Deterministic, URL/DB-safe key for an embedding space identity. */
export function deriveSpaceKey(id: EmbeddingSpaceIdentity): string {
  return [sanitize(id.provider), sanitize(id.model), sanitize(id.version), String(id.dimension), sanitize(id.normalizationPolicy)].join(':');
}

/** Build the identity for an EmbeddingProvider under a given normalization policy. */
export function spaceIdentityFromProvider(provider: EmbeddingProvider, normalizationPolicy: string): EmbeddingSpaceIdentity {
  return {
    provider: provider.name,
    model: provider.model,
    version: provider.version,
    dimension: provider.dimension(),
    normalizationPolicy,
  };
}

export function spaceKeyForProvider(provider: EmbeddingProvider, normalizationPolicy: string): string {
  return deriveSpaceKey(spaceIdentityFromProvider(provider, normalizationPolicy));
}

/** Whether two identities describe the same comparable embedding space. */
export function spacesEqual(a: EmbeddingSpaceIdentity, b: EmbeddingSpaceIdentity): boolean {
  return deriveSpaceKey(a) === deriveSpaceKey(b);
}

/** Derive a space key from persisted chunk embedding columns (NULL-safe). */
export function spaceKeyFromChunkColumns(cols: { embedding_provider: string; embedding_model: string; embedding_version: string; embedding_dimension: number; normalizationPolicy?: string }): string {
  return deriveSpaceKey({
    provider: cols.embedding_provider,
    model: cols.embedding_model,
    version: cols.embedding_version,
    dimension: cols.embedding_dimension,
    normalizationPolicy: cols.normalizationPolicy ?? 'L2_NORMALIZED',
  });
}
