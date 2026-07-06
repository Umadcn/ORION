/**
 * LocalHashEmbedding — the default offline embedding provider.
 *
 * IMPORTANT: LocalHashEmbedding provides deterministic offline lexical feature
 * vectors for development, testing, and fallback retrieval. It is NOT a neural
 * semantic embedding model. It is not a transformer, not sentence-transformers,
 * not OpenAI embeddings, and not any ML model. It ALWAYS reports the execution
 * mode LOCAL_HASH_FALLBACK and must never be represented as a real embedding
 * provider.
 *
 * Approach: deterministic signed feature hashing over lowercased unigrams and
 * adjacent bigrams. Each term is hashed (SHA-256); the hash selects a bucket
 * index and a sign, and a sublinear term weight is accumulated. The resulting
 * vector is L2-normalized for cosine similarity. Same normalized text always
 * yields the same finite vector.
 */
import crypto from 'node:crypto';
import { assertFiniteVector, l2Normalize, type EmbeddingProvider } from './provider.js';
import type { EmbeddingExecutionMode } from '../knowledge/types.js';

const VERSION = 'orion-localhash-v1';
const MODEL = 'orion-localhash-v1';
const NAME = 'local-hash';
const DEFAULT_MAX_INPUT_CHARS = 40000;

export class LocalHashEmbedding implements EmbeddingProvider {
  readonly name = NAME;
  readonly model = MODEL;
  readonly version = VERSION;
  readonly mode: EmbeddingExecutionMode = 'LOCAL_HASH_FALLBACK';
  private readonly dim: number;
  private readonly maxChars: number;

  constructor(dimension = 256, maxInputChars = DEFAULT_MAX_INPUT_CHARS) {
    // Bound the dimension to a sane, finite range.
    const d = Math.floor(dimension);
    this.dim = Number.isFinite(d) ? Math.max(16, Math.min(4096, d)) : 256;
    this.maxChars = Math.max(1000, Math.min(200000, Math.floor(maxInputChars)));
  }

  dimension(): number {
    return this.dim;
  }

  maxInputChars(): number {
    return this.maxChars;
  }

  isAvailable(): boolean {
    return true; // always available — no config, no network
  }

  async embedText(text: string): Promise<number[]> {
    return this.embedOne(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  /** Synchronous variant (local hashing is fully in-process) — used by the
   *  offline seed path so startup can remain synchronous. */
  embedTextSync(text: string): number[] {
    return this.embedOne(text);
  }

  embedBatchSync(texts: string[]): number[][] {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const truncated = (text ?? '').slice(0, this.maxChars);
    const tokens = tokenize(truncated);

    for (let i = 0; i < tokens.length; i++) {
      this.accumulate(vec, tokens[i], 1);
      // Adjacent bigram for a little phrase sensitivity (still purely lexical).
      if (i + 1 < tokens.length) {
        this.accumulate(vec, `${tokens[i]}_${tokens[i + 1]}`, 0.5);
      }
    }

    const normalized = l2Normalize(vec);
    assertFiniteVector(normalized, this.dim);
    return normalized;
  }

  private accumulate(vec: number[], term: string, weight: number): void {
    const digest = crypto.createHash('sha256').update(term, 'utf8').digest();
    // First 4 bytes -> bucket index; next byte parity -> sign.
    const bucket = digest.readUInt32BE(0) % this.dim;
    const sign = (digest[4] & 1) === 0 ? 1 : -1;
    vec[bucket] += sign * weight;
  }
}

/** Lowercase, split on non-alphanumeric. Numbers/units are preserved as tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}
