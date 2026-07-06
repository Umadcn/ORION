/**
 * Read-only tool: search past (RESOLVED/REJECTED) investigations by satellite,
 * root cause, or anomaly terms. Deterministic lexical match — no LLM, no network.
 */
import { db } from '../../db.js';
import type { Investigation } from '../../types.js';
import { tokenize } from '../../retrieval/tokenize.js';
import type { ToolDefinition } from '../types.js';

export const searchHistoricalInvestigationsTool: ToolDefinition = {
  name: 'searchHistoricalInvestigations',
  description: 'Find past resolved/rejected investigations similar to a query or anomaly context. Read-only.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2500,
  maxOutputChars: 4000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: { query: { type: 'string' }, satelliteId: { type: 'string' }, limit: { type: 'integer' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['results'],
    properties: { results: { type: 'array', items: { type: 'object' } } },
  },
  execute(args) {
    const limit = Math.max(1, Math.min(Math.floor(Number(args.limit) || 5), 15));
    const terms = new Set(tokenize(String(args.query ?? ''), { maxTokens: 32 }).flatMap((t) => t.split(/[-_]/)));
    const clauses: string[] = ["status IN ('RESOLVED','REJECTED')"];
    const params: unknown[] = [];
    if (args.satelliteId) { clauses.push('satellite_id = ?'); params.push(String(args.satelliteId).toUpperCase()); }
    const rows = db
      .prepare(`SELECT * FROM investigations WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT 200`)
      .all(...params) as Investigation[];

    const scored = rows
      .map((r) => {
        const hay = new Set(tokenize(`${r.satellite_id} ${r.root_cause ?? ''} ${r.detected_anomalies} ${r.explanation ?? ''}`, { maxTokens: 256 }).flatMap((t) => t.split(/[-_]/)));
        let score = 0;
        for (const t of terms) if (hay.has(t)) score++;
        return { r, score };
      })
      .filter((x) => x.score > 0 || terms.size === 0)
      .sort((a, b) => (b.score - a.score) || (b.r.id - a.r.id))
      .slice(0, limit);

    return {
      count: scored.length,
      results: scored.map(({ r }) => ({
        investigation_id: r.id,
        satellite_id: r.satellite_id,
        status: r.status,
        root_cause: r.root_cause,
        severity: r.severity,
        explanation: (r.explanation ?? '').slice(0, 300),
      })),
    };
  },
};
