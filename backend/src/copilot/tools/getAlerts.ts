/** Read-only tool: bounded alert list, optionally filtered by satellite/status. */
import { db } from '../../db.js';
import type { Alert } from '../../types.js';
import type { ToolDefinition } from '../types.js';

export const getAlertsTool: ToolDefinition = {
  name: 'getAlerts',
  description: 'List recent alerts, optionally filtered by satellite and status. Read-only.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 4000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      satelliteId: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'] },
      limit: { type: 'integer' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['alerts'],
    properties: { alerts: { type: 'array', items: { type: 'object' } } },
  },
  execute(args) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (args.satelliteId) { clauses.push('satellite_id = ?'); params.push(String(args.satelliteId).toUpperCase()); }
    if (args.status) { clauses.push('status = ?'); params.push(String(args.status)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(Math.floor(Number(args.limit) || 10), 25));
    const rows = db.prepare(`SELECT * FROM alerts ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit) as Alert[];
    return {
      count: rows.length,
      alerts: rows.map((a) => ({
        id: a.id,
        satellite_id: a.satellite_id,
        anomaly_type: a.anomaly_type,
        severity: a.severity,
        status: a.status,
        message: a.message,
        investigation_id: a.investigation_id,
        created_at: a.created_at,
      })),
    };
  },
};
