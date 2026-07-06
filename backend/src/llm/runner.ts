/**
 * LlmRunner — the single execution path for all LLM calls.
 *
 * Request → validate config → select provider → enforce input budget → execute
 * with timeout → validate structured output → retry eligible failures with
 * bounded exponential backoff → deterministic fallback (if allowed) → persist
 * audit record → return a normalized response.
 *
 * Execution mode is assigned here and only here: real output is REAL_PROVIDER,
 * fallback output is DETERMINISTIC_FALLBACK, total failure is FAILED. Fallback
 * output can NEVER be labeled REAL_PROVIDER.
 */
import crypto from 'node:crypto';
import { config, redactSecrets } from '../config.js';
import { createLlmExecution } from '../services/llmAuditService.js';
import { DeterministicFallbackProvider } from './deterministicProvider.js';
import { buildRealProvider } from './httpProvider.js';
import { ProviderError, estimateMessagesTokens, estimateTokens, type LlmProvider } from './provider.js';
import { parseAndValidate } from './schema.js';
import type {
  LlmError, LlmRequest, LlmResponse, LlmUsage, RawCompletion, StructuredValidationResult,
} from './types.js';

export interface RunnerConfig {
  timeoutMs: number;
  maxRetries: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  fallbackEnabled: boolean;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export interface RunnerDeps {
  realProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider;
  audit?: (rec: Parameters<typeof createLlmExecution>[0]) => number;
  sleep?: (ms: number) => Promise<void>;
  config?: Partial<RunnerConfig>;
}

const SUMMARY_MAX = 2000;

/** Bounded exponential backoff — pure + testable. */
export function computeBackoff(attempt: number, base: number, max: number): number {
  return Math.min(max, base * 2 ** attempt);
}

export class LlmRunner {
  private realProvider: LlmProvider | null;
  private fallbackProvider: LlmProvider;
  private audit: (rec: Parameters<typeof createLlmExecution>[0]) => number;
  private sleep: (ms: number) => Promise<void>;
  private cfg: RunnerConfig;

  constructor(deps: RunnerDeps = {}) {
    this.realProvider = deps.realProvider !== undefined ? deps.realProvider : buildRealProvider();
    this.fallbackProvider = deps.fallbackProvider ?? new DeterministicFallbackProvider();
    this.audit = deps.audit ?? createLlmExecution;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.cfg = {
      timeoutMs: deps.config?.timeoutMs ?? config.llm.timeoutMs,
      maxRetries: deps.config?.maxRetries ?? config.llm.maxRetries,
      maxInputTokens: deps.config?.maxInputTokens ?? config.llm.maxInputTokens,
      maxOutputTokens: deps.config?.maxOutputTokens ?? config.llm.maxOutputTokens,
      fallbackEnabled: deps.config?.fallbackEnabled ?? config.llm.fallbackEnabled,
      baseBackoffMs: deps.config?.baseBackoffMs ?? 100,
      maxBackoffMs: deps.config?.maxBackoffMs ?? 2000,
    };
  }

  async run<T = unknown>(request: LlmRequest): Promise<LlmResponse<T>> {
    const started = Date.now();
    const correlationId = request.correlationId ?? crypto.randomUUID();
    const inputTokens = estimateMessagesTokens(request.messages);
    const structuredRequested = !!request.structuredOutput;

    let retryCount = 0;
    let realError: ProviderError | null = null;
    let realInvalid: StructuredValidationResult | null = null;

    // --- Attempt the real provider (if configured + available) ---
    if (this.realProvider && this.realProvider.isAvailable()) {
      if (inputTokens > this.cfg.maxInputTokens) {
        realError = new ProviderError('INPUT_BUDGET_EXCEEDED', `Input ${inputTokens} exceeds budget ${this.cfg.maxInputTokens}`, false);
      } else {
        for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
          try {
            const raw = await this.executeWithTimeout(this.realProvider, request);
            if (structuredRequested) {
              const parsed = parseAndValidate<T>(raw.content, request.structuredOutput!.schema);
              if (!parsed.ok) {
                realInvalid = parsed.result; // schema failures are NOT retried
                break;
              }
              return this.finalize<T>({
                request, correlationId, started, mode: 'REAL_PROVIDER', status: 'SUCCESS',
                provider: this.realProvider.name, model: this.realProvider.model,
                content: raw.content, structured: parsed.value, usage: normalizeUsage(raw, inputTokens),
                finishReason: raw.finishReason ?? 'stop', validation: { valid: true, errors: [] },
                retryCount, fallbackReason: null, error: null, inputTokens,
              });
            }
            return this.finalize<T>({
              request, correlationId, started, mode: 'REAL_PROVIDER', status: 'SUCCESS',
              provider: this.realProvider.name, model: this.realProvider.model,
              content: raw.content, structured: null, usage: normalizeUsage(raw, inputTokens),
              finishReason: raw.finishReason ?? 'stop', validation: null,
              retryCount, fallbackReason: null, error: null, inputTokens,
            });
          } catch (err) {
            const pe = err instanceof ProviderError ? err : new ProviderError('UNKNOWN', (err as Error).message, false);
            realError = pe;
            if (pe.retryable && attempt < this.cfg.maxRetries) {
              retryCount++;
              await this.sleep(computeBackoff(attempt, this.cfg.baseBackoffMs, this.cfg.maxBackoffMs));
              continue;
            }
            break;
          }
        }
      }
    }

    // --- Deterministic fallback (if enabled) ---
    const fallbackReason = realInvalid
      ? 'REAL_PROVIDER_INVALID_OUTPUT'
      : realError
      ? `REAL_PROVIDER_ERROR:${realError.code}`
      : 'NO_REAL_PROVIDER_CONFIGURED';

    if (this.cfg.fallbackEnabled) {
      const raw = await this.fallbackProvider.generate(request, new AbortController().signal);
      let structured: T | null = null;
      let validation: StructuredValidationResult | null = null;
      if (structuredRequested) {
        const parsed = parseAndValidate<T>(raw.content, request.structuredOutput!.schema);
        validation = parsed.ok ? { valid: true, errors: [] } : parsed.result;
        structured = parsed.ok ? parsed.value : null;
      }
      return this.finalize<T>({
        request, correlationId, started, mode: 'DETERMINISTIC_FALLBACK', status: 'FALLBACK',
        provider: this.fallbackProvider.name, model: this.fallbackProvider.model,
        content: raw.content, structured, usage: normalizeUsage(raw, inputTokens),
        finishReason: 'fallback', validation, retryCount, fallbackReason,
        error: realError ? toLlmError(realError) : null, inputTokens,
      });
    }

    // --- No fallback allowed → FAILED ---
    const err: LlmError = realError
      ? toLlmError(realError)
      : realInvalid
      ? { code: 'INVALID_OUTPUT', message: realInvalid.errors.join('; '), retryable: false }
      : { code: 'NO_PROVIDER', message: 'No provider available and fallback disabled', retryable: false };
    return this.finalize<T>({
      request, correlationId, started, mode: 'FAILED', status: 'FAILED',
      provider: this.realProvider?.name ?? 'none', model: this.realProvider?.model ?? 'none',
      content: null, structured: null, usage: { inputTokens }, finishReason: 'error',
      validation: realInvalid, retryCount, fallbackReason: null, error: err, inputTokens,
    });
  }

  private async executeWithTimeout(provider: LlmProvider, request: LlmRequest): Promise<RawCompletion> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      return await provider.generate(request, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private finalize<T>(p: {
    request: LlmRequest; correlationId: string; started: number;
    mode: LlmResponse['executionMode']; status: LlmResponse['status'];
    provider: string; model: string; content: string | null; structured: T | null;
    usage: LlmUsage; finishReason: LlmResponse['finishReason'];
    validation: StructuredValidationResult | null; retryCount: number;
    fallbackReason: string | null; error: LlmError | null; inputTokens: number;
  }): LlmResponse<T> {
    const latencyMs = Date.now() - p.started;
    const response: LlmResponse<T> = {
      executionMode: p.mode,
      status: p.status,
      provider: p.provider,
      model: p.model,
      promptVersion: p.request.promptVersion,
      requestType: p.request.requestType,
      correlationId: p.correlationId,
      content: p.content,
      structured: p.structured,
      usage: p.usage,
      latencyMs,
      finishReason: p.finishReason,
      structuredOutputRequested: !!p.request.structuredOutput,
      validation: p.validation,
      retryCount: p.retryCount,
      fallbackReason: p.fallbackReason,
      error: p.error,
    };

    // Opt-in, sanitized, truncated payload summaries only.
    const persist = p.request.persistPayloads === true;
    this.audit({
      correlation_id: p.correlationId,
      investigation_id: p.request.investigationId ?? null,
      agent_execution_id: p.request.agentExecutionId ?? null,
      provider: p.provider,
      model: p.model,
      execution_mode: p.mode,
      execution_status: p.status,
      prompt_version: p.request.promptVersion,
      request_type: p.request.requestType,
      input_token_count: p.usage.inputTokens ?? null,
      output_token_count: p.usage.outputTokens ?? null,
      total_token_count: p.usage.totalTokens ?? (((p.usage.inputTokens ?? 0) + (p.usage.outputTokens ?? 0)) || null),
      latency_ms: latencyMs,
      retry_count: p.retryCount,
      structured_output_requested: !!p.request.structuredOutput,
      structured_output_valid: p.validation ? p.validation.valid : null,
      validation_errors: p.validation && !p.validation.valid ? p.validation.errors : null,
      fallback_reason: p.fallbackReason,
      error_code: p.error?.code ?? null,
      sanitized_error_message: p.error ? redactSecrets(p.error.message).slice(0, 500) : null,
      request_summary: persist ? redactSecrets(p.request.messages.map((m) => `${m.role}: ${m.content}`).join('\n')).slice(0, SUMMARY_MAX) : null,
      response_summary: persist && p.content ? redactSecrets(p.content).slice(0, SUMMARY_MAX) : null,
    });

    return response;
  }
}

function normalizeUsage(raw: RawCompletion, inputTokens: number): LlmUsage {
  const inp = raw.usage?.inputTokens ?? inputTokens;
  const out = raw.usage?.outputTokens ?? estimateTokens(raw.content);
  return { inputTokens: inp, outputTokens: out, totalTokens: raw.usage?.totalTokens ?? inp + out };
}

function toLlmError(pe: ProviderError): LlmError {
  return { code: pe.code, message: redactSecrets(pe.message), retryable: pe.retryable };
}

/** Shared app-wide runner instance (built from environment config). */
export const llmRunner = new LlmRunner();
