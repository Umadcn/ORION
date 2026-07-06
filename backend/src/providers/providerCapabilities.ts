/**
 * Explicit provider capability construction (Phase 9). Capabilities come from
 * configuration only — never inferred from the provider name. No credentials.
 */
import { config } from '../config.js';
import type { EmbeddingProviderCapabilities, LlmProviderCapabilities } from './types.js';

export function llmCapabilities(): LlmProviderCapabilities {
  const l = config.llm;
  const p = config.providers;
  return {
    providerName: l.provider,
    model: l.model || null,
    supportsStructuredOutput: p.llmSupportsStructuredOutput,
    supportsJsonSchema: p.llmSupportsJsonSchema,
    supportsToolCalling: p.llmSupportsToolCalling,
    supportsStreaming: p.llmSupportsStreaming,
    maxInputTokens: l.maxInputTokens,
    maxOutputTokens: l.maxOutputTokens,
  };
}

export function embeddingCapabilities(): EmbeddingProviderCapabilities {
  const e = config.embedding;
  const p = config.providers;
  return {
    providerName: e.provider,
    model: e.model || null,
    dimension: e.dimension,
    maxInputTokens: e.dimension, // informational bound only
    maxBatchSize: e.maxBatchSize,
    normalizedOutput: p.embeddingNormalized,
  };
}
