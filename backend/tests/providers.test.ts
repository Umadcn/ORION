/**
 * Phase 9 provider + embedding-space + verification + comparison unit/service
 * tests. Offline + deterministic. Real-provider verification is exercised with a
 * MOCK provider; a mock success is NEVER reported as live-provider verification
 * outside these controlled tests. Fallback can never satisfy live verification.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema, db } from '../src/db.js';
import { seedIfEmpty } from '../src/seed/seedData.js';
import { seedKnowledgeIfEmpty } from '../src/knowledge/seed.js';
import { config, isTrustedEndpoint, isLlmProviderConfiguredSafely, isEmbeddingProviderConfiguredSafely } from '../src/config.js';
import { LlmRunner } from '../src/llm/runner.js';
import type { LlmProvider } from '../src/llm/provider.js';
import { ProviderError } from '../src/llm/provider.js';
import type { RawCompletion } from '../src/llm/types.js';
import type { EmbeddingProvider } from '../src/embeddings/provider.js';
import { deriveSpaceKey, spacesEqual, spaceKeyFromChunkColumns } from '../src/providers/embeddingSpace.js';
import { llmCapabilities, embeddingCapabilities } from '../src/providers/providerCapabilities.js';
import { validateLlmProvider } from '../src/providers/providerValidation.js';
import { llmStatus, embeddingStatus } from '../src/providers/providerRegistry.js';
import { ProviderHealthService } from '../src/providers/providerHealthService.js';
import { reindexCorpus, effectiveActiveSpace, chunkSpaceStats } from '../src/providers/embeddingSpaceService.js';
import { getActiveSpaceKey, activateEmbeddingSpace, upsertEmbeddingSpace } from '../src/providers/providerRepository.js';
import { retrieve, RetrievalSpaceMismatchError } from '../src/knowledge/retrievalService.js';

beforeAll(() => {
  initSchema();
  seedIfEmpty();
  seedKnowledgeIfEmpty();
});

// --- Configuration + endpoint trust ---------------------------------------
describe('provider configuration + endpoint trust', () => {
  it('endpoint trust: https ok, http non-loopback rejected, loopback http ok, invalid rejected', () => {
    expect(isTrustedEndpoint('https://api.example.com/v1').trusted).toBe(true);
    expect(isTrustedEndpoint('http://api.example.com/v1').trusted).toBe(false);
    expect(isTrustedEndpoint('http://127.0.0.1:1234/v1').trusted).toBe(true);
    expect(isTrustedEndpoint('not-a-url').trusted).toBe(false);
    expect(isTrustedEndpoint('').trusted).toBe(false);
  });
  it('offline: neither provider is configured safely; startup defaults hold', () => {
    expect(isLlmProviderConfiguredSafely().ok).toBe(false);
    expect(isEmbeddingProviderConfiguredSafely().ok).toBe(false);
    expect(validateLlmProvider().configuredSafely).toBe(false);
  });
  it('capability model comes from config (never inferred from name)', () => {
    const l = llmCapabilities();
    expect(l.supportsStructuredOutput).toBe(config.providers.llmSupportsStructuredOutput);
    expect(l.maxOutputTokens).toBe(config.llm.maxOutputTokens);
    const e = embeddingCapabilities();
    expect(e.dimension).toBe(config.embedding.dimension);
    expect(e.normalizedOutput).toBe(config.providers.embeddingNormalized);
  });
  it('registry: offline → OFFLINE operating mode (configured ≠ available)', () => {
    expect(llmStatus(Date.now()).operatingMode).toBe('OFFLINE');
    expect(embeddingStatus(Date.now()).operatingMode).toBe('OFFLINE');
  });
});

// --- Embedding-space identity ---------------------------------------------
describe('embedding-space identity', () => {
  it('deterministic key + equality + mismatch', () => {
    const a = { provider: 'local', model: 'm', version: 'v1', dimension: 256, normalizationPolicy: 'L2_NORMALIZED' };
    const b = { ...a };
    const c = { ...a, dimension: 512 };
    expect(deriveSpaceKey(a)).toBe(deriveSpaceKey(b));
    expect(spacesEqual(a, b)).toBe(true);
    expect(spacesEqual(a, c)).toBe(false);
    expect(spaceKeyFromChunkColumns({ embedding_provider: 'local', embedding_model: 'm', embedding_version: 'v1', embedding_dimension: 256 })).toBe(deriveSpaceKey(a));
  });
});

// --- LLM verification (MOCK provider) --------------------------------------
class MockLlm implements LlmProvider {
  name = 'mock-openai'; model = 'mock-1';
  constructor(private behavior: 'ok' | 'malformed' | 'auth') {}
  capabilities() { return { structuredOutput: true, streaming: false }; }
  isAvailable() { return true; }
  async generate(): Promise<RawCompletion> {
    if (this.behavior === 'auth') throw new ProviderError('AUTH', 'HTTP 401', false);
    if (this.behavior === 'malformed') return { content: 'not json at all', finishReason: 'stop' };
    return { content: '{"ok":true,"echo":"orion"}', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 } };
  }
}
function healthWithMock(behavior: 'ok' | 'malformed' | 'auth', cooldownMs = 0) {
  const orig = config.providers.verificationCooldownMs;
  config.providers.verificationCooldownMs = cooldownMs;
  const svc = new ProviderHealthService({
    buildRunner: () => new LlmRunner({ realProvider: new MockLlm(behavior), config: { fallbackEnabled: false, maxRetries: 0 } }),
    llmConfiguredSafely: () => true,
  });
  return { svc, restore: () => { config.providers.verificationCooldownMs = orig; } };
}

describe('LLM live verification (mock provider)', () => {
  it('genuine real response → REAL_PROVIDER_VERIFIED, live reached, usage available', async () => {
    const { svc, restore } = healthWithMock('ok');
    const r = await svc.verifyLlm('u1');
    restore();
    expect(r.status).toBe('REAL_PROVIDER_VERIFIED');
    expect(r.liveProviderReached).toBe(true);
    expect(r.structuredOutputValid).toBe(true);
    expect(r.usageMetadataAvailable).toBe(true);
  });
  it('malformed real response → DEGRADED (reached, not real-accepted)', async () => {
    const { svc, restore } = healthWithMock('malformed');
    const r = await svc.verifyLlm('u1');
    restore();
    expect(r.status).toBe('DEGRADED');
    expect(r.structuredOutputValid).toBe(false);
    expect(r.status).not.toBe('REAL_PROVIDER_VERIFIED');
  });
  it('auth failure → UNAVAILABLE, never real', async () => {
    const { svc, restore } = healthWithMock('auth');
    const r = await svc.verifyLlm('u1');
    restore();
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.liveProviderReached).toBe(false);
  });
  it('NOT configured → NOT_CONFIGURED (deterministic fallback can never verify)', async () => {
    const svc = new ProviderHealthService({ llmConfiguredSafely: () => false });
    const r = await svc.verifyLlm('u1');
    expect(r.status).toBe('NOT_CONFIGURED');
    expect(r.liveProviderReached).toBe(false);
  });
  it('cooldown blocks a rapid second verification', async () => {
    const { svc, restore } = healthWithMock('ok', 60000);
    await svc.verifyLlm('u1');
    const second = await svc.verifyLlm('u1');
    restore();
    expect(second.status).toBe('COOLDOWN');
    expect(second.liveProviderReached).toBe(false);
  });
});

// --- Embedding verification (MOCK provider) --------------------------------
class MockEmbedding implements EmbeddingProvider {
  name = 'mock-openai'; model = 'mock-embed'; version = 'mock-v1'; mode = 'REAL_EMBEDDING_PROVIDER' as const;
  constructor(private behavior: 'ok' | 'baddim' | 'nan' | 'network', private dim = 8) {}
  dimension() { return this.dim; }
  maxInputChars() { return 1000; }
  isAvailable() { return true; }
  async embedText(): Promise<number[]> {
    if (this.behavior === 'network') throw Object.assign(new Error('net'), { code: 'NETWORK' });
    if (this.behavior === 'baddim') return new Array(this.dim + 1).fill(0.1);
    if (this.behavior === 'nan') return new Array(this.dim).fill(NaN);
    return new Array(this.dim).fill(0.1);
  }
  async embedBatch(texts: string[]): Promise<number[][]> { return Promise.all(texts.map(() => this.embedText())); }
}
function embHealth(behavior: 'ok' | 'baddim' | 'nan' | 'network' | 'none') {
  config.providers.verificationCooldownMs = 0; // no cooldown between these controlled checks
  return new ProviderHealthService({
    resolveRealEmbedding: () => (behavior === 'none' ? null : new MockEmbedding(behavior)),
    embeddingConfiguredSafely: () => behavior !== 'none',
  });
}

describe('embedding live verification (mock provider)', () => {
  it('genuine vector → REAL_EMBEDDING_VERIFIED', async () => {
    const r = await embHealth('ok').verifyEmbedding('u1');
    expect(r.status).toBe('REAL_EMBEDDING_VERIFIED');
    expect(r.liveProviderReached).toBe(true);
    expect(r.embeddingDimensionValid).toBe(true);
  });
  it('dimension mismatch → DEGRADED', async () => {
    const r = await embHealth('baddim').verifyEmbedding('u1');
    expect(r.status).toBe('DEGRADED');
    expect(r.embeddingDimensionValid).toBe(false);
  });
  it('non-finite vector → DEGRADED', async () => {
    const r = await embHealth('nan').verifyEmbedding('u1');
    expect(r.status).toBe('DEGRADED');
  });
  it('network failure → UNAVAILABLE', async () => {
    const r = await embHealth('network').verifyEmbedding('u1');
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.liveProviderReached).toBe(false);
  });
  it('not configured → NOT_CONFIGURED (fallback never labeled real)', async () => {
    const r = await embHealth('none').verifyEmbedding('u1');
    expect(r.status).toBe('NOT_CONFIGURED');
  });
});

// --- Corpus re-embedding + active space + fail-closed retrieval ------------
describe('corpus re-embedding + active space integrity', () => {
  it('reindex (LocalHash) completes, activates atomically, preserves citations, single space', async () => {
    const anyCitation = (db.prepare('SELECT citation_id FROM knowledge_chunks LIMIT 1').get() as { citation_id: string }).citation_id;
    const r = await reindexCorpus({ userId: 'admin' });
    expect(r.status).toBe('COMPLETED');
    expect(r.processedDocuments).toBe(r.totalDocuments);
    expect(getActiveSpaceKey()).toBe(r.targetSpaceKey);
    expect(effectiveActiveSpace().persisted).toBe(true);
    // Citation IDs are stable across re-embedding.
    expect(db.prepare('SELECT citation_id FROM knowledge_chunks WHERE citation_id = ?').get(anyCitation)).toBeTruthy();
    // Single embedding space across the corpus.
    expect(chunkSpaceStats().length).toBe(1);
  });
  it('idempotent: a second reindex stays COMPLETED with the same space key', async () => {
    const first = getActiveSpaceKey();
    const r = await reindexCorpus({ userId: 'admin' });
    expect(r.status).toBe('COMPLETED');
    expect(r.targetSpaceKey).toBe(first);
  });
  it('retrieval works within the active space', async () => {
    const res = await retrieve({ query: 'battery degradation', mode: 'VECTOR', topK: 3 });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.diagnostics.embeddingSpaceKey).toBe(getActiveSpaceKey());
  });
  it('fail-closed: a mismatched active space makes VECTOR retrieval fail closed', async () => {
    const realKey = getActiveSpaceKey()!;
    // Register + activate an incompatible fake space (different provider/dimension).
    const fakeKey = 'openai:text-embedding-3-large:v1:3072:L2_NORMALIZED';
    upsertEmbeddingSpace({ space_key: fakeKey, provider: 'openai', model: 'text-embedding-3-large', version: 'v1', dimension: 3072, normalization_policy: 'L2_NORMALIZED', status: 'COMPLETED', document_count: 0, chunk_count: 0 });
    activateEmbeddingSpace(fakeKey);
    await expect(retrieve({ query: 'battery', mode: 'VECTOR', topK: 3 })).rejects.toBeInstanceOf(RetrievalSpaceMismatchError);
    // Restore the real active space so other suites are unaffected.
    activateEmbeddingSpace(realKey);
  });
});
