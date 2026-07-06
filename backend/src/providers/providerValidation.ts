/**
 * Provider configuration validation (Phase 9). Pure, deterministic, no network.
 * Reuses the config-level safety checks (allowlist + trusted endpoint) and adds
 * per-kind completeness reporting. Never exposes credentials.
 */
import { config, isLlmProviderConfiguredSafely, isEmbeddingProviderConfiguredSafely, isTrustedEndpoint } from '../config.js';
import type { ProviderKind } from './types.js';

export interface ProviderValidation {
  kind: ProviderKind;
  providerName: string;
  allowlisted: boolean;
  endpointConfigured: boolean;
  apiKeyConfigured: boolean;
  modelConfigured: boolean;
  endpointTrusted: boolean;
  configuredSafely: boolean;
  reason: string | null;
}

export function validateLlmProvider(): ProviderValidation {
  const l = config.llm;
  const safe = isLlmProviderConfiguredSafely();
  return {
    kind: 'LLM',
    providerName: l.provider,
    allowlisted: config.providers.llmAllowlist.includes(l.provider),
    endpointConfigured: !!l.endpoint,
    apiKeyConfigured: !!l.apiKey,
    modelConfigured: !!l.model,
    endpointTrusted: l.endpoint ? isTrustedEndpoint(l.endpoint).trusted : false,
    configuredSafely: safe.ok,
    reason: safe.reason,
  };
}

export function validateEmbeddingProvider(): ProviderValidation {
  const e = config.embedding;
  const safe = isEmbeddingProviderConfiguredSafely();
  return {
    kind: 'EMBEDDING',
    providerName: e.provider,
    allowlisted: config.providers.embeddingAllowlist.includes(e.provider),
    endpointConfigured: !!e.endpoint,
    apiKeyConfigured: !!e.apiKey,
    modelConfigured: !!e.model,
    endpointTrusted: e.endpoint ? isTrustedEndpoint(e.endpoint).trusted : false,
    configuredSafely: safe.ok,
    reason: safe.reason,
  };
}
