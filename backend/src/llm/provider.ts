/**
 * LlmProvider abstraction. Application code depends only on this interface,
 * never on a specific vendor. Providers normalize their own errors into
 * ProviderError with a stable, sanitized code + retryable flag.
 */
import type { LlmRequest, ProviderCapabilities, RawCompletion } from './types.js';

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  capabilities(): ProviderCapabilities;
  /** Cheap, synchronous readiness check (e.g. required config present). */
  isAvailable(): boolean;
  /** Produce a completion. Must honor the abort signal for cancellation/timeout. */
  generate(request: LlmRequest, signal: AbortSignal): Promise<RawCompletion>;
}

export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Rough, deterministic token estimate (~4 chars/token) — no tokenizer dep. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: { content: string }[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
