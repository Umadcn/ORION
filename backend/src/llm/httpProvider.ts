/**
 * Optional real LLM provider over an OpenAI-compatible Chat Completions HTTP
 * API. Enabled ONLY when ORION_LLM_* env config is present. Never hardcodes an
 * endpoint, key, or model. Uses the injected/global fetch with an AbortSignal
 * for cancellation/timeout. API keys are never logged or returned.
 */
import { config } from '../config.js';
import { ProviderError, type LlmProvider } from './provider.js';
import type { LlmRequest, ProviderCapabilities, RawCompletion } from './types.js';

type FetchLike = typeof fetch;

export interface HttpProviderOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
}

export class HttpLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: HttpProviderOptions) {
    this.name = config.llm.provider !== 'none' ? config.llm.provider : 'http';
    this.model = opts.model;
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  capabilities(): ProviderCapabilities {
    return { structuredOutput: true, streaming: false };
  }

  isAvailable(): boolean {
    return !!(this.endpoint && this.apiKey && this.model);
  }

  async generate(request: LlmRequest, signal: AbortSignal): Promise<RawCompletion> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: request.temperature ?? 0,
      max_tokens: request.maxOutputTokens ?? config.llm.maxOutputTokens,
    };
    if (request.structuredOutput) {
      // OpenAI-compatible JSON mode; providers that ignore it still return text
      // which the runner validates against the schema.
      body.response_format = { type: 'json_object' };
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new ProviderError('TIMEOUT', 'Request aborted (timeout)', true);
      throw new ProviderError('NETWORK', `Network error: ${(err as Error).message}`, true);
    }

    if (!res.ok) {
      const status = res.status;
      const retryable = status === 429 || status >= 500;
      const code = status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'SERVER' : 'REQUEST';
      // Never surface response bodies that may echo credentials.
      throw new ProviderError(code, `Provider HTTP ${status}`, retryable);
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new ProviderError('BAD_RESPONSE', 'Provider returned non-JSON body', false);
    }

    const choice = json?.choices?.[0];
    const content: string | undefined = choice?.message?.content ?? choice?.text;
    if (typeof content !== 'string') {
      throw new ProviderError('BAD_RESPONSE', 'Provider response missing message content', false);
    }

    const usage = json?.usage
      ? {
          inputTokens: json.usage.prompt_tokens,
          outputTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
      : undefined;

    const finishReason = choice?.finish_reason === 'length' ? 'length' : 'stop';
    return { content, usage, finishReason };
  }
}

/** Build the configured real provider, or null if not configured. */
export function buildRealProvider(fetchImpl?: FetchLike): HttpLlmProvider | null {
  const l = config.llm;
  if (l.provider === 'none' || !l.endpoint || !l.apiKey || !l.model) return null;
  return new HttpLlmProvider({ endpoint: l.endpoint, apiKey: l.apiKey, model: l.model, fetchImpl });
}
