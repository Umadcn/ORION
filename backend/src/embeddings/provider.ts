/**
 * EmbeddingProvider abstraction. Application code depends only on this
 * interface, never on a specific vendor. Providers normalize their own errors
 * into EmbeddingError with a stable, sanitized code + retryable flag.
 *
 * Execution mode is the load-bearing safety concept:
 *   - REAL_EMBEDDING_PROVIDER : produced by a configured external model
 *   - LOCAL_HASH_FALLBACK      : produced by LocalHashEmbedding (deterministic
 *                                lexical feature hashing — NOT a neural model)
 *   - FAILED                   : embedding could not be produced
 */
import type { EmbeddingExecutionMode } from '../knowledge/types.js';

export interface EmbeddingResult {
  vectors: number[][];
  mode: EmbeddingExecutionMode;
  provider: string;
  model: string;
  version: string;
  dimension: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  /** Model/implementation identifier (e.g. 'orion-localhash-v1'). */
  readonly model: string;
  /** Stable implementation/version identifier. */
  readonly version: string;
  /** The mode this provider ALWAYS reports for its output. */
  readonly mode: EmbeddingExecutionMode;
  /** Fixed output vector dimension. */
  dimension(): number;
  /** Maximum characters accepted per input. */
  maxInputChars(): number;
  /** Cheap, synchronous readiness check. */
  isAvailable(): boolean;
  embedText(text: string, signal?: AbortSignal): Promise<number[]>;
  embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** L2-normalize a vector in place-safe manner. Zero vector stays zero. */
export function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0 || !Number.isFinite(norm)) return vec.slice();
  return vec.map((v) => v / norm);
}

/** Cosine similarity of two equal-length vectors. Assumes finite inputs. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('cosineSimilarity: dimension mismatch');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0 || !Number.isFinite(denom)) return 0;
  return dot / denom;
}

/** Reject vectors containing NaN/Infinity or the wrong dimension. */
export function assertFiniteVector(vec: number[], expectedDim?: number): void {
  if (!Array.isArray(vec)) throw new EmbeddingError('BAD_VECTOR', 'Vector is not an array', false);
  if (expectedDim !== undefined && vec.length !== expectedDim) {
    throw new EmbeddingError('DIMENSION_MISMATCH', `Expected dimension ${expectedDim}, got ${vec.length}`, false);
  }
  for (const v of vec) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new EmbeddingError('NON_FINITE', 'Vector contains a non-finite value', false);
    }
  }
}
