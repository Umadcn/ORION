/** Read-only tool: fetch a report by report id or investigation id (bounded). */
import { getReport as getRep, getReportForInvestigation } from '../../services/reportService.js';
import type { ToolDefinition } from '../types.js';

export const getReportTool: ToolDefinition = {
  name: 'getReport',
  description: 'Get an investigation report by reportId or investigationId. Read-only, bounded.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 4000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { reportId: { type: 'integer' }, investigationId: { type: 'integer' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['found'],
    properties: { found: { type: 'boolean' } },
  },
  execute(args) {
    const report =
      args.reportId !== undefined
        ? getRep(Math.floor(Number(args.reportId)))
        : args.investigationId !== undefined
        ? getReportForInvestigation(Math.floor(Number(args.investigationId)))
        : undefined;
    if (!report) return { found: false };
    let summary = '';
    try {
      const content = JSON.parse(report.content) as Record<string, unknown>;
      summary = typeof content.summary === 'string' ? content.summary : '';
    } catch { /* content not JSON */ }
    return {
      found: true,
      report_id: report.id,
      investigation_id: report.investigation_id,
      title: report.title,
      summary: summary.slice(0, 800),
      created_at: report.created_at,
    };
  },
};
