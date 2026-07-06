/**
 * Optional real embedding provider over an OpenAI-compatible embeddings HTTP
 * API. Enabled ONLY when ORION_EMBEDDING_* env config is present. Never
 * hardcodes an endpoint, key, or model. Uses the injected/global fetch with an
 * AbortSignal for cancellation/timeout. API keys are never logged or returned.
 *
 * This is a forward-looking seam: the platform does NOT require a live embedding
 * API. With the default configuration the LocalHashEmbedding provider is used.
 */
import { config } from '../config.js';
import { assertFiniteVector, EmbeddingError, type EmbeddingProvider } from './provider.js';
import type { EmbeddingExecutionMode } from '../knowledge/types.js';

type FetchLike = typeof fetch;

export interface HttpEmbeddingOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  dimension: number;
  maxBatchSize: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly version = 'http-embedding-v1';
  readonly mode: EmbeddingExecutionMode = 'REAL_EMBEDDING_PROVIDER';
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly dim: number;
  private readonly maxBatch: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: HttpEmbeddingOptions) {
    this.name = config.embedding.provider !== 'none' ? config.embedding.provider : 'http';
    this.model = opts.model;
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey;
    this.dim = opts.dimension;
    this.maxBatch = Math.max(1, opts.maxBatchSize);
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  dimension(): number {
    return this.dim;
  }

  maxInputChars(): number {
    return 40000;
  }

  isAvailable(): boolean {
    return !!(this.endpoint && this.apiKey && this.model);
  }

  async embedText(text: string, signal?: AbortSignal): Promise<number[]> {
    const [vec] = await this.embedBatch([text], signal);
    return vec;
  }

  async embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length > this.maxBatch) {
      throw new EmbeddingError('BATCH_TOO_LARGE', `Batch of ${texts.length} exceeds max ${this.maxBatch}`, false);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new EmbeddingError('TIMEOUT', 'Embedding request aborted (timeout)', true);
      throw new EmbeddingError('NETWORK', `Network error: ${(err as Error).message}`, true);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const status = res.status;
      const retryable = status === 429 || status >= 500;
      const code = status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'SERVER' : 'REQUEST';
      throw new EmbeddingError(code, `Embedding provider HTTP ${status}`, retryable);
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new EmbeddingError('BAD_RESPONSE', 'Embedding provider returned non-JSON body', false);
    }

    const data = json?.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EmbeddingError('BAD_RESPONSE', 'Embedding response shape invalid', false);
    }
    const vectors: number[][] = data.map((d: any) => d?.embedding);
    for (const v of vectors) assertFiniteVector(v, this.dim);
    return vectors;
  }
}

/** Build the configured real embedding provider, or null if not configured. */
export function buildRealEmbeddingProvider(fetchImpl?: FetchLike): HttpEmbeddingProvider | null {
  const e = config.embedding;
  if (e.provider === 'local' || e.provider === 'none' || !e.endpoint || !e.apiKey || !e.model) return null;
  return new HttpEmbeddingProvider({
    endpoint: e.endpoint,
    apiKey: e.apiKey,
    model: e.model,
    dimension: e.dimension,
    maxBatchSize: e.maxBatchSize,
    timeoutMs: e.timeoutMs,
    fetchImpl,
  });
}
