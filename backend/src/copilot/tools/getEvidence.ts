/** Read-only tool: deterministic evidence for an investigation (surfaces evidence IDs). */
import { getEvidence as getEv } from '../../services/investigationService.js';
import type { ToolDefinition } from '../types.js';

export const getEvidenceTool: ToolDefinition = {
  name: 'getEvidence',
  description: 'List the deterministic evidence items for an investigation, with their evidence IDs.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 4000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['investigationId'],
    properties: { investigationId: { type: 'integer' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['investigationId', 'evidence'],
    properties: { investigationId: { type: 'integer' }, evidence: { type: 'array', items: { type: 'object' } } },
  },
  execute(args) {
    const id = Math.floor(Number(args.investigationId));
    const rows = Number.isFinite(id) ? getEv(id) : [];
    return {
      investigationId: id,
      count: rows.length,
      evidence: rows.map((e) => ({
        evidence_id: String(e.id),
        source_type: e.source_type,
        source_name: e.source_name,
        summary: e.summary,
        supports_root_cause: !!e.supports_root_cause,
      })),
    };
  },
};
