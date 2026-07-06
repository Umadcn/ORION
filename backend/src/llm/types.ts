/**
 * Provider-independent LLM contracts.
 *
 * Execution mode is the load-bearing safety concept: DETERMINISTIC_FALLBACK
 * output is NEVER represented as REAL_PROVIDER. The runner is the only place
 * that assigns the mode, based on which provider actually produced the output.
 */
import type { JsonSchema } from './schema.js';

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

/** How the output was produced. */
export type LlmExecutionMode = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' | 'FAILED';

/** Overall outcome recorded in the audit trail. */
export type LlmExecutionStatus = 'SUCCESS' | 'FALLBACK' | 'FAILED';

export type LlmFinishReason = 'stop' | 'length' | 'timeout' | 'error' | 'fallback';

export interface StructuredOutputSchema {
  name: string;
  schema: JsonSchema;
}

export interface LlmRequest {
  /** Logical category, e.g. 'hypothesis-generation' | 'debug' | 'test'. */
  requestType: string;
  /** Prompt template version for auditability, e.g. 'v1'. */
  promptVersion: string;
  messages: LlmMessage[];
  /** If set, the runner validates the model output against this schema. */
  structuredOutput?: StructuredOutputSchema;
  /**
   * Grounding seed used ONLY by the deterministic fallback provider to shape a
   * schema-valid response from real, already-computed data (never fabricated).
   */
  fallbackSeed?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  /** Correlate related executions; generated if omitted. */
  correlationId?: string;
  investigationId?: number | null;
  agentExecutionId?: number | null;
  /** Opt-in, sanitized persistence of truncated request/response summaries. */
  persistPayloads?: boolean;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmError {
  code: string;
  message: string; // already sanitized before it reaches here
  retryable: boolean;
}

export interface StructuredValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ProviderCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  maxContextTokens?: number;
}

/** Raw output returned by a provider before the runner normalizes it. */
export interface RawCompletion {
  content: string;
  usage?: LlmUsage;
  finishReason?: LlmFinishReason;
}

export interface LlmResponse<T = unknown> {
  executionMode: LlmExecutionMode;
  status: LlmExecutionStatus;
  provider: string;
  model: string;
  promptVersion: string;
  requestType: string;
  correlationId: string;
  content: string | null;
  structured: T | null;
  usage: LlmUsage;
  latencyMs: number;
  finishReason: LlmFinishReason;
  structuredOutputRequested: boolean;
  validation: StructuredValidationResult | null;
  retryCount: number;
  fallbackReason: string | null;
  error: LlmError | null;
}
