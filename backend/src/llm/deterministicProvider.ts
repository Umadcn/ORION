/**
 * DeterministicFallbackProvider — fully offline, deterministic, bounded.
 *
 * It does NOT generate novel content and never claims to. For structured
 * requests it shapes a schema-VALID object from the caller-supplied grounding
 * seed (real, already-computed data) plus type-safe defaults. For text requests
 * it returns a clearly-marked deterministic summary of the request.
 *
 * The runner labels any output from this provider as DETERMINISTIC_FALLBACK.
 */
import type { LlmProvider } from './provider.js';
import { estimateTokens } from './provider.js';
import type { JsonSchema } from './schema.js';
import type { LlmRequest, ProviderCapabilities, RawCompletion } from './types.js';

export class DeterministicFallbackProvider implements LlmProvider {
  readonly name = 'deterministic-fallback';
  readonly model = 'orion-deterministic-v1';

  capabilities(): ProviderCapabilities {
    return { structuredOutput: true, streaming: false };
  }

  isAvailable(): boolean {
    return true;
  }

  async generate(request: LlmRequest): Promise<RawCompletion> {
    let content: string;
    if (request.structuredOutput) {
      const shaped = synthesizeFromSchema(request.structuredOutput.schema, request.fallbackSeed);
      content = JSON.stringify(shaped);
    } else {
      content = this.textResponse(request);
    }
    return {
      content,
      finishReason: 'stop',
      usage: {
        inputTokens: request.messages.reduce((s, m) => s + estimateTokens(m.content), 0),
        outputTokens: estimateTokens(content),
      },
    };
  }

  private textResponse(request: LlmRequest): string {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    return (
      `[DETERMINISTIC_FALLBACK] Offline deterministic response for request type "${request.requestType}" ` +
      `(prompt ${request.promptVersion}). No generative model is configured; this content is derived ` +
      `deterministically from supplied context and is not model-generated.` +
      (lastUser ? ` Context digest: ${digest(lastUser.content)}.` : '')
    );
  }
}

/**
 * Build a schema-valid value. When the seed provides a matching, type-correct
 * value it is used verbatim (grounded); otherwise a safe typed default is used.
 */
export function synthesizeFromSchema(schema: JsonSchema, seed: unknown): unknown {
  if (schema.nullable && seed === null) return null;
  switch (schema.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      const seedObj = isRecord(seed) ? seed : {};
      const props = schema.properties ?? {};
      for (const [key, propSchema] of Object.entries(props)) {
        out[key] = synthesizeFromSchema(propSchema, seedObj[key]);
      }
      return out;
    }
    case 'array': {
      if (Array.isArray(seed) && schema.items) return seed.map((s) => synthesizeFromSchema(schema.items!, s));
      const min = schema.minItems ?? 0;
      if (min > 0 && schema.items) return Array.from({ length: min }, () => synthesizeFromSchema(schema.items!, undefined));
      return [];
    }
    case 'string':
      if (typeof seed === 'string' && (!schema.enum || schema.enum.includes(seed))) return seed;
      if (schema.enum && schema.enum.length > 0) return schema.enum[0];
      return '';
    case 'integer':
      return typeof seed === 'number' && Number.isInteger(seed) ? seed : 0;
    case 'number':
      return typeof seed === 'number' ? seed : 0;
    case 'boolean':
      return typeof seed === 'boolean' ? seed : false;
    case 'null':
      return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Small, stable, non-cryptographic digest for a deterministic marker. */
function digest(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
