/**
 * Phase 1 LLM foundation unit + integration tests. No network, no API key.
 * Real-provider behavior is exercised with mock providers / mocked fetch.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema } from '../src/db.js';
import { LlmRunner, computeBackoff } from '../src/llm/runner.js';
import { DeterministicFallbackProvider, synthesizeFromSchema } from '../src/llm/deterministicProvider.js';
import { HttpLlmProvider } from '../src/llm/httpProvider.js';
import { ProviderError, type LlmProvider } from '../src/llm/provider.js';
import { validateJsonSchema, parseAndValidate, type JsonSchema } from '../src/llm/schema.js';
import { redactSecrets } from '../src/config.js';
import { createLlmExecution, listLlmExecutions } from '../src/services/llmAuditService.js';
import type { LlmRequest, RawCompletion } from '../src/llm/types.js';

const SCHEMA: JsonSchema = {
  type: 'object',
  required: ['title', 'score', 'tags'],
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    score: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } },
    nested: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
  },
};

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  requestType: 'test',
  promptVersion: 'v1',
  messages: [{ role: 'user', content: 'hello mission control' }],
  ...over,
});

// --- Mock providers ---
class SuccessProvider implements LlmProvider {
  name = 'mock-real'; model = 'mock-1';
  constructor(private content: string, private usage?: RawCompletion['usage']) {}
  capabilities() { return { structuredOutput: true, streaming: false }; }
  isAvailable() { return true; }
  async generate(): Promise<RawCompletion> { return { content: this.content, usage: this.usage, finishReason: 'stop' }; }
}
class FlakyProvider implements LlmProvider {
  name = 'mock-real'; model = 'mock-1'; calls = 0;
  constructor(private failTimes: number, private err: ProviderError, private content = '{}') {}
  capabilities() { return { structuredOutput: true, streaming: false }; }
  isAvailable() { return true; }
  async generate(): Promise<RawCompletion> {
    this.calls++;
    if (this.calls <= this.failTimes) throw this.err;
    return { content: this.content, finishReason: 'stop' };
  }
}
class HangingProvider implements LlmProvider {
  name = 'mock-real'; model = 'mock-1';
  capabilities() { return { structuredOutput: true, streaming: false }; }
  isAvailable() { return true; }
  generate(_r: LlmRequest, signal: AbortSignal): Promise<RawCompletion> {
    return new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(new ProviderError('TIMEOUT', 'aborted', true)));
    });
  }
}

const fastRunner = (deps: ConstructorParameters<typeof LlmRunner>[0] = {}) =>
  new LlmRunner({ audit: () => 0, sleep: async () => {}, config: { baseBackoffMs: 0, maxBackoffMs: 0, ...deps.config }, ...deps });

// ================= Schema validation =================
describe('schema validation', () => {
  it('accepts valid structured output', () => {
    const r = validateJsonSchema(SCHEMA, { title: 'x', score: 0.8, tags: ['a', 'b'] });
    expect(r.valid).toBe(true);
  });
  it('flags a missing required field', () => {
    const r = validateJsonSchema(SCHEMA, { score: 1, tags: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/title/);
  });
  it('flags a wrong primitive type', () => {
    const r = validateJsonSchema(SCHEMA, { title: 'x', score: 'high', tags: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/score/);
  });
  it('validates nested objects', () => {
    const r = validateJsonSchema(SCHEMA, { title: 'x', score: 1, tags: [], nested: {} });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/nested\.ok/);
  });
  it('rejects additional properties when disallowed', () => {
    const r = validateJsonSchema(SCHEMA, { title: 'x', score: 1, tags: [], extra: 1 });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/additional property/);
  });
  it('handles malformed JSON', () => {
    const r = parseAndValidate('{not json', SCHEMA);
    expect(r.ok).toBe(false);
  });
});

// ================= Deterministic fallback provider =================
describe('DeterministicFallbackProvider', () => {
  it('is deterministic (same request → same output)', async () => {
    const p = new DeterministicFallbackProvider();
    const a = await p.generate(req(), new AbortController().signal);
    const b = await p.generate(req(), new AbortController().signal);
    expect(a.content).toBe(b.content);
  });
  it('shapes schema-valid output from the grounding seed (grounded, not fabricated)', () => {
    const shaped = synthesizeFromSchema(SCHEMA, { title: 'Payload fault', score: 0.8, tags: ['power'], extra: 'dropped' });
    expect(validateJsonSchema(SCHEMA, shaped).valid).toBe(true);
    expect((shaped as any).title).toBe('Payload fault');
    expect((shaped as any).extra).toBeUndefined();
  });
  it('marks text responses as deterministic (never claims to be generative)', async () => {
    const p = new DeterministicFallbackProvider();
    const r = await p.generate(req(), new AbortController().signal);
    expect(r.content).toContain('DETERMINISTIC_FALLBACK');
  });
});

// ================= HTTP provider normalization =================
describe('HttpLlmProvider', () => {
  it('normalizes the request body (model, messages, max_tokens, response_format)', async () => {
    let captured: any = null;
    const fakeFetch = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"a","score":1,"tags":[]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) };
    }) as unknown as typeof fetch;
    const p = new HttpLlmProvider({ endpoint: 'http://local.test/v1/chat', apiKey: 'k', model: 'm1', fetchImpl: fakeFetch });
    const out = await p.generate(req({ structuredOutput: { name: 's', schema: SCHEMA } }), new AbortController().signal);
    expect(captured.model).toBe('m1');
    expect(captured.messages[0].content).toContain('hello');
    expect(captured.response_format).toEqual({ type: 'json_object' });
    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
  });
  it('normalizes auth errors as non-retryable', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    const p = new HttpLlmProvider({ endpoint: 'http://local.test', apiKey: 'k', model: 'm', fetchImpl: fakeFetch });
    await expect(p.generate(req(), new AbortController().signal)).rejects.toMatchObject({ code: 'AUTH', retryable: false });
  });
  it('normalizes 5xx as retryable', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const p = new HttpLlmProvider({ endpoint: 'http://local.test', apiKey: 'k', model: 'm', fetchImpl: fakeFetch });
    await expect(p.generate(req(), new AbortController().signal)).rejects.toMatchObject({ code: 'SERVER', retryable: true });
  });
});

// ================= Backoff =================
describe('computeBackoff', () => {
  it('is bounded by max', () => {
    expect(computeBackoff(0, 100, 2000)).toBe(100);
    expect(computeBackoff(1, 100, 2000)).toBe(200);
    expect(computeBackoff(10, 100, 2000)).toBe(2000); // capped
  });
});

// ================= Runner behavior =================
describe('LlmRunner', () => {
  it('uses deterministic fallback when no real provider is configured', async () => {
    const r = await fastRunner({ realProvider: null }).run(req({ structuredOutput: { name: 's', schema: SCHEMA }, fallbackSeed: { title: 't', score: 0.5, tags: [] } }));
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
    expect(r.status).toBe('FALLBACK');
    expect(r.fallbackReason).toBe('NO_REAL_PROVIDER_CONFIGURED');
    expect(r.validation?.valid).toBe(true);
  });
  it('returns REAL_PROVIDER on success and never mislabels it', async () => {
    const r = await fastRunner({ realProvider: new SuccessProvider('{"title":"a","score":1,"tags":[]}') })
      .run(req({ structuredOutput: { name: 's', schema: SCHEMA } }));
    expect(r.executionMode).toBe('REAL_PROVIDER');
    expect(r.status).toBe('SUCCESS');
    expect(r.structured).toMatchObject({ title: 'a' });
  });
  it('fallback output is never labeled REAL_PROVIDER', async () => {
    const r = await fastRunner({ realProvider: new SuccessProvider('bad json') })
      .run(req({ structuredOutput: { name: 's', schema: SCHEMA } }));
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
    expect(r.fallbackReason).toBe('REAL_PROVIDER_INVALID_OUTPUT');
  });
  it('retries retryable failures up to the max, then falls back', async () => {
    const flaky = new FlakyProvider(5, new ProviderError('SERVER', 'boom', true));
    const r = await fastRunner({ realProvider: flaky, config: { maxRetries: 2 } }).run(req());
    expect(flaky.calls).toBe(3); // 1 + 2 retries
    expect(r.retryCount).toBe(2);
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
  });
  it('recovers when a retryable failure eventually succeeds', async () => {
    const flaky = new FlakyProvider(1, new ProviderError('RATE_LIMIT', 'slow', true), '{"title":"ok","score":1,"tags":[]}');
    const r = await fastRunner({ realProvider: flaky, config: { maxRetries: 3 } }).run(req({ structuredOutput: { name: 's', schema: SCHEMA } }));
    expect(r.executionMode).toBe('REAL_PROVIDER');
    expect(r.retryCount).toBe(1);
  });
  it('does NOT retry non-retryable failures', async () => {
    const flaky = new FlakyProvider(5, new ProviderError('AUTH', 'bad key', false));
    const r = await fastRunner({ realProvider: flaky, config: { maxRetries: 3 } }).run(req());
    expect(flaky.calls).toBe(1);
    expect(r.retryCount).toBe(0);
    expect(r.fallbackReason).toBe('REAL_PROVIDER_ERROR:AUTH');
  });
  it('handles timeout via AbortController and falls back', async () => {
    const r = await fastRunner({ realProvider: new HangingProvider(), config: { timeoutMs: 20, maxRetries: 0 } }).run(req());
    expect(r.fallbackReason).toBe('REAL_PROVIDER_ERROR:TIMEOUT');
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
  });
  it('enforces the input token budget (skips real provider)', async () => {
    const big = 'x'.repeat(5000);
    const r = await fastRunner({ realProvider: new SuccessProvider('{}'), config: { maxInputTokens: 10 } })
      .run(req({ messages: [{ role: 'user', content: big }] }));
    expect(r.fallbackReason).toBe('REAL_PROVIDER_ERROR:INPUT_BUDGET_EXCEEDED');
  });
  it('returns FAILED when fallback is disabled and the provider fails', async () => {
    const r = await fastRunner({ realProvider: new SuccessProvider('bad'), config: { fallbackEnabled: false } })
      .run(req({ structuredOutput: { name: 's', schema: SCHEMA } }));
    expect(r.executionMode).toBe('FAILED');
    expect(r.status).toBe('FAILED');
  });
  it('persists an audit record with the correct mode/status', async () => {
    const captured: any[] = [];
    await new LlmRunner({ realProvider: null, audit: (rec) => { captured.push(rec); return 1; }, sleep: async () => {} }).run(req());
    expect(captured).toHaveLength(1);
    expect(captured[0].execution_mode).toBe('DETERMINISTIC_FALLBACK');
    expect(captured[0].execution_status).toBe('FALLBACK');
  });
});

// ================= Secret redaction =================
describe('redactSecrets', () => {
  it('redacts bearer tokens and key-like fields', () => {
    const out = redactSecrets('Authorization: Bearer abc.def.ghi and api_key=sk-1234567890abcd');
    expect(out).not.toContain('abc.def.ghi');
    expect(out).toMatch(/REDACTED/);
  });
});

// ================= Audit persistence (real DB) =================
describe('llm audit persistence', () => {
  beforeAll(() => initSchema());
  it('creates and lists executions with pagination + filtering', () => {
    for (let i = 0; i < 3; i++) {
      createLlmExecution({
        correlation_id: `c${i}`, provider: 'deterministic-fallback', model: 'orion-deterministic-v1',
        execution_mode: 'DETERMINISTIC_FALLBACK', execution_status: 'FALLBACK', prompt_version: 'v1',
        request_type: 'test', latency_ms: 1, retry_count: 0, structured_output_requested: false,
      });
    }
    const all = listLlmExecutions({ limit: 2 });
    expect(all.items.length).toBe(2);
    expect(all.total).toBeGreaterThanOrEqual(3);
    const filtered = listLlmExecutions({ mode: 'DETERMINISTIC_FALLBACK' });
    expect(filtered.items.every((x) => x.execution_mode === 'DETERMINISTIC_FALLBACK')).toBe(true);
    expect(filtered.items[0].sanitized_error_message).toBeNull();
  });
});
