/**
 * Read-only tool: resolve a citation to its exact bounded source (Phase 10).
 * No raw vectors, no filesystem paths, no secrets, no unrelated chunks.
 */
import { buildSourceReference } from '../sourceInspection.js';
import type { ToolDefinition } from '../../copilot/types.js';

export const resolveCitationTool: ToolDefinition = {
  name: 'resolveCitation',
  description: 'Resolve a citation ID to its document title, version, provenance, and an exact bounded excerpt.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 2000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['citationId'],
    properties: { citationId: { type: 'string' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['found'],
    properties: { found: { type: 'boolean' } },
  },
  execute(args) {
    const ref = buildSourceReference(String(args.citationId ?? ''));
    if (!ref) return { found: false, citationId: String(args.citationId ?? '') };
    return { found: true, ...ref };
  },
  extractGrounding(output: unknown) {
    const o = output as { found?: boolean; citationId?: string; excerpt?: string; documentId?: number; documentTitle?: string };
    if (!o.found || !o.citationId) return {};
    return { citations: [{ citationId: o.citationId, text: o.excerpt ?? '', documentId: o.documentId ?? 0, title: o.documentTitle ?? '' }] };
  },
};
