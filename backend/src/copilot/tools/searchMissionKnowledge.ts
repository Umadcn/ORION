/**
 * Read-only tool: hybrid retrieval over the Mission Knowledge Base (Phase 3).
 * Surfaces resolvable citations used later for claim-level grounding.
 */
import crypto from 'node:crypto';
import { db } from '../../db.js';
import { config } from '../../config.js';
import { retrieve } from '../../knowledge/retrievalService.js';
import type { RetrievalFilter } from '../../knowledge/types.js';
import type { ToolDefinition } from '../types.js';

export const searchMissionKnowledgeTool: ToolDefinition = {
  name: 'searchMissionKnowledge',
  description: 'Search the offline Mission Knowledge Base (hybrid retrieval) and return cited passages.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 4000,
  maxOutputChars: 6000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string' },
      topK: { type: 'integer' },
      subsystem: { type: 'string' },
      satelliteId: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['results'],
    properties: { results: { type: 'array', items: { type: 'object' } } },
  },
  async execute(args) {
    const query = String(args.query ?? '').slice(0, config.retrieval.maxQueryChars);
    const topK = Math.max(1, Math.min(Math.floor(Number(args.topK) || 5), config.retrieval.maxTopK));
    const filters: RetrievalFilter = {};
    if (args.subsystem) filters.subsystem = String(args.subsystem);
    if (args.satelliteId) filters.satelliteId = String(args.satelliteId).toUpperCase();
    const correlationId = crypto.randomUUID();
    const result = await retrieve({ query, topK, filters, mode: 'HYBRID_RRF_RERANK', correlationId });
    const row = db.prepare('SELECT id FROM retrieval_executions WHERE correlation_id = ? ORDER BY id DESC LIMIT 1').get(correlationId) as { id: number } | undefined;
    return {
      query,
      retrievalMode: result.retrievalMode,
      retrievalExecutionId: row ? row.id : null,
      results: result.items.map((i) => ({
        citation_id: i.citationId,
        title: i.title,
        snippet: i.content.slice(0, 400),
        text: i.content, // used for grounding (stripped from the model-facing summary)
        documentId: i.documentId,
      })),
    };
  },
  extractGrounding(output: unknown) {
    const o = output as { results?: { citation_id: string; text: string; documentId: number; title: string }[]; retrievalExecutionId?: number | null };
    const citations = (o.results ?? []).map((r) => ({ citationId: r.citation_id, text: r.text ?? '', documentId: r.documentId, title: r.title }));
    return { citations, retrievalExecutionId: o.retrievalExecutionId ?? null };
  },
};
