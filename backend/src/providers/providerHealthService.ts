/**
 * Provider health / conformance verification (Phase 9). Director/Admin, opt-in,
 * bounded, timeout-protected, cooldown-guarded, audited. NEVER runs at startup.
 *
 * LLM verification goes through LlmRunner (the only application path to a
 * provider) with fallback DISABLED, so a failed real call yields FAILED — never
 * a deterministic-fallback result mislabeled as real. Embedding verification
 * calls the configured real EmbeddingProvider directly. A genuine external call
 * that succeeds and is accepted is the ONLY way to reach *_VERIFIED.
 */
import crypto from 'node:crypto';
import { config, redactSecrets, isLlmProviderConfiguredSafely, isEmbeddingProviderConfiguredSafely } from '../config.js';
import { LlmRunner } from '../llm/runner.js';
import { buildRealEmbeddingProvider } from '../embeddings/httpEmbeddingProvider.js';
import { assertFiniteVector, type EmbeddingProvider } from '../embeddings/provider.js';
import type { JsonSchema } from '../llm/schema.js';
import { createVerification, msSinceLastVerification, toVerificationResult, type CreateVerification } from './providerRepository.js';
import type { ProviderKind, VerificationResult, VerificationStatus } from './types.js';

/** Fixed, internal, bounded verification request — never caller-supplied. */
const VERIFY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' }, echo: { type: 'string' } },
};
const VERIFY_SYSTEM = 'You are a health probe. Respond with ONLY the strict JSON object {"ok": true, "echo": "orion"}.';
const VERIFY_USER = 'Return {"ok": true, "echo": "orion"} exactly.';
const VERIFY_EMBEDDING_INPUT = 'ORION provider embedding health probe.';

export interface HealthDeps {
  buildRunner?: () => LlmRunner;
  resolveRealEmbedding?: () => EmbeddingProvider | null;
  nowMs?: () => number;
  llmConfiguredSafely?: () => boolean;
  embeddingConfiguredSafely?: () => boolean;
}

export class ProviderHealthService {
  private buildRunner: () => LlmRunner;
  private resolveRealEmbedding: () => EmbeddingProvider | null;
  private nowMs: () => number;
  private llmSafe: () => boolean;
  private embSafe: () => boolean;

  constructor(deps: HealthDeps = {}) {
    this.buildRunner = deps.buildRunner ?? (() => new LlmRunner({ config: { fallbackEnabled: false, maxRetries: 0, timeoutMs: config.providers.verificationTimeoutMs } }));
    this.resolveRealEmbedding = deps.resolveRealEmbedding ?? (() => buildRealEmbeddingProvider());
    this.nowMs = deps.nowMs ?? (() => Date.now());
    this.llmSafe = deps.llmConfiguredSafely ?? (() => isLlmProviderConfiguredSafely().ok);
    this.embSafe = deps.embeddingConfiguredSafely ?? (() => isEmbeddingProviderConfiguredSafely().ok);
  }

  private cooldownActive(kind: ProviderKind): boolean {
    const since = msSinceLastVerification(kind, this.nowMs());
    return since !== null && since < config.providers.verificationCooldownMs;
  }

  private persist(rec: CreateVerification): VerificationResult {
    const createdAt = new Date(this.nowMs()).toISOString();
    const id = createVerification(rec);
    return toVerificationResult(id, rec, createdAt);
  }

  async verifyLlm(userId: string | null): Promise<VerificationResult> {
    const started = this.nowMs();
    const correlationId = crypto.randomUUID();
    const base: Omit<CreateVerification, 'status' | 'live_provider_reached' | 'latency_ms' | 'structured_output_valid' | 'usage_metadata_available' | 'normalized_error_code' | 'sanitized_error_message'> = {
      correlation_id: correlationId, provider_kind: 'LLM', provider_name: config.llm.provider, model: config.llm.model || null,
      verification_type: 'LLM_GENERATION', embedding_dimension_valid: null, created_by: userId,
    };

    if (!this.llmSafe()) {
      return this.persist({ ...base, status: 'NOT_CONFIGURED', live_provider_reached: false, latency_ms: 0, structured_output_valid: null, usage_metadata_available: null, normalized_error_code: 'NOT_CONFIGURED', sanitized_error_message: 'No safely-configured LLM provider' });
    }
    if (this.cooldownActive('LLM')) {
      return { verificationId: null, correlationId, providerKind: 'LLM', providerName: config.llm.provider, model: config.llm.model || null, verificationType: 'LLM_GENERATION', status: 'COOLDOWN', liveProviderReached: false, latencyMs: 0, structuredOutputValid: null, embeddingDimensionValid: null, usageMetadataAvailable: null, normalizedErrorCode: 'COOLDOWN', sanitizedErrorMessage: 'Verification cooldown active', createdAt: new Date(this.nowMs()).toISOString() };
    }

    let status: VerificationStatus = 'FAILED';
    let live = false;
    let structuredValid: boolean | null = null;
    let usageAvailable: boolean | null = null;
    let errCode: string | null = null;
    let errMsg: string | null = null;

    try {
      const resp = await this.buildRunner().run<{ ok: boolean }>({
        requestType: 'provider-verification', promptVersion: 'orion-provider-verify-v1',
        messages: [{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content: VERIFY_USER }],
        structuredOutput: { name: 'orion_provider_verify', schema: VERIFY_SCHEMA }, correlationId,
      });
      if (resp.executionMode === 'REAL_PROVIDER') {
        live = true;
        structuredValid = !!resp.structured && resp.validation?.valid !== false;
        usageAvailable = resp.usage.outputTokens !== undefined && resp.usage.outputTokens !== null;
        status = structuredValid ? 'REAL_PROVIDER_VERIFIED' : 'DEGRADED';
        if (!structuredValid) errCode = 'STRUCTURED_OUTPUT_INVALID';
      } else if (resp.validation && resp.validation.valid === false) {
        // Reached the provider but the structured output was malformed → DEGRADED (never real).
        live = true;
        structuredValid = false;
        status = 'DEGRADED';
        errCode = 'STRUCTURED_OUTPUT_INVALID';
      } else {
        // FAILED (fallback disabled): not reached / auth / network error. Never labeled real.
        status = 'UNAVAILABLE';
        errCode = resp.error?.code ?? 'NO_REAL_PROVIDER';
        errMsg = resp.error ? redactSecrets(resp.error.message).slice(0, 300) : 'Real provider did not produce output';
      }
    } catch (err) {
      status = 'FAILED';
      errCode = 'UNEXPECTED';
      errMsg = redactSecrets((err as Error).message).slice(0, 300);
    }

    return this.persist({ ...base, status, live_provider_reached: live, latency_ms: this.nowMs() - started, structured_output_valid: structuredValid, usage_metadata_available: usageAvailable, normalized_error_code: errCode, sanitized_error_message: errMsg });
  }

  async verifyEmbedding(userId: string | null): Promise<VerificationResult> {
    const started = this.nowMs();
    const correlationId = crypto.randomUUID();
    const provider = this.resolveRealEmbedding();
    const base: Omit<CreateVerification, 'status' | 'live_provider_reached' | 'latency_ms' | 'structured_output_valid' | 'embedding_dimension_valid' | 'usage_metadata_available' | 'normalized_error_code' | 'sanitized_error_message'> = {
      correlation_id: correlationId, provider_kind: 'EMBEDDING', provider_name: config.embedding.provider, model: config.embedding.model || null, verification_type: 'EMBEDDING', created_by: userId,
    };

    if (!this.embSafe() || !provider || !provider.isAvailable()) {
      return this.persist({ ...base, status: 'NOT_CONFIGURED', live_provider_reached: false, latency_ms: 0, structured_output_valid: null, embedding_dimension_valid: null, usage_metadata_available: null, normalized_error_code: 'NOT_CONFIGURED', sanitized_error_message: 'No safely-configured embedding provider' });
    }
    if (this.cooldownActive('EMBEDDING')) {
      return { verificationId: null, correlationId, providerKind: 'EMBEDDING', providerName: config.embedding.provider, model: config.embedding.model || null, verificationType: 'EMBEDDING', status: 'COOLDOWN', liveProviderReached: false, latencyMs: 0, structuredOutputValid: null, embeddingDimensionValid: null, usageMetadataAvailable: null, normalizedErrorCode: 'COOLDOWN', sanitizedErrorMessage: 'Verification cooldown active', createdAt: new Date(this.nowMs()).toISOString() };
    }

    let status: VerificationStatus = 'FAILED';
    let live = false;
    let dimValid: boolean | null = null;
    let errCode: string | null = null;
    let errMsg: string | null = null;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), config.providers.verificationTimeoutMs);
      let vec: number[];
      try {
        vec = await provider.embedText(VERIFY_EMBEDDING_INPUT, ctrl.signal);
      } finally {
        clearTimeout(timer);
      }
      // Genuine vector received — validate dimension + finiteness.
      assertFiniteVector(vec, provider.dimension());
      live = true;
      dimValid = vec.length === provider.dimension();
      status = dimValid ? 'REAL_EMBEDDING_VERIFIED' : 'DEGRADED';
      if (!dimValid) errCode = 'DIMENSION_MISMATCH';
    } catch (err) {
      const e = err as { code?: string; message?: string };
      // A dimension/finite error means we DID reach the provider but conformance failed.
      const conformance = e.code === 'DIMENSION_MISMATCH' || e.code === 'NON_FINITE' || e.code === 'BAD_VECTOR';
      live = conformance;
      status = conformance ? 'DEGRADED' : 'UNAVAILABLE';
      errCode = e.code ?? 'UNEXPECTED';
      errMsg = redactSecrets(e.message ?? 'Embedding verification failed').slice(0, 300);
      dimValid = conformance ? false : null;
    }

    return this.persist({ ...base, status, live_provider_reached: live, latency_ms: this.nowMs() - started, structured_output_valid: null, embedding_dimension_valid: dimValid, usage_metadata_available: null, normalized_error_code: errCode, sanitized_error_message: errMsg });
  }
}

export const providerHealthService = new ProviderHealthService();
