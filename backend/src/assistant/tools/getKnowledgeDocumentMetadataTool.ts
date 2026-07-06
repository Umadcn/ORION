/**
 * Read-only tool: knowledge document metadata (Phase 10). Metadata only — no
 * filesystem paths, no raw vectors, no full-content dump.
 */
import { documentMetadata } from '../sourceInspection.js';
import type { ToolDefinition } from '../../copilot/types.js';

export const getKnowledgeDocumentMetadataTool: ToolDefinition = {
  name: 'getKnowledgeDocumentMetadata',
  description: 'Get read-only metadata (title, version, provenance origin, subsystem) for a knowledge document.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 2000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['documentId'],
    properties: { documentId: { type: 'integer' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['found'],
    properties: { found: { type: 'boolean' } },
  },
  execute(args) {
    const meta = documentMetadata(Number(args.documentId));
    if (!meta) return { found: false, documentId: Math.floor(Number(args.documentId)) };
    return { found: true, ...meta };
  },
};
