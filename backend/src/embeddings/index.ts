/**
 * Embedding provider selection.
 *
 * Offline-first: the default provider is LocalHashEmbedding (LOCAL_HASH_FALLBACK).
 * A real HTTP embedding provider is used ONLY when fully configured via
 * ORION_EMBEDDING_* env vars. No network is required for startup, ingestion, or
 * retrieval under the default configuration.
 *
 * A single provider instance is used for both ingestion and retrieval within a
 * run so that stored vectors and query vectors share the same vector space and
 * dimension. We do NOT silently mix real and fallback vectors in one store.
 */
import { config } from '../config.js';
import { LocalHashEmbedding } from './localHashEmbedding.js';
import { buildRealEmbeddingProvider } from './httpEmbeddingProvider.js';
import type { EmbeddingProvider } from './provider.js';

export interface ResolvedEmbeddingProvider {
  provider: EmbeddingProvider;
  isFallback: boolean;
}

/**
 * Resolve the active embedding provider. When a real provider is configured and
 * available, it is used; otherwise the deterministic LocalHashEmbedding fallback
 * is used.
 */
export function resolveEmbeddingProvider(fetchImpl?: typeof fetch): ResolvedEmbeddingProvider {
  const real = buildRealEmbeddingProvider(fetchImpl);
  if (real && real.isAvailable()) {
    return { provider: real, isFallback: false };
  }
  return { provider: new LocalHashEmbedding(config.embedding.dimension), isFallback: true };
}

export { LocalHashEmbedding } from './localHashEmbedding.js';
export { HttpEmbeddingProvider, buildRealEmbeddingProvider } from './httpEmbeddingProvider.js';
export {
  EmbeddingError,
  cosineSimilarity,
  l2Normalize,
  assertFiniteVector,
  type EmbeddingProvider,
} from './provider.js';
