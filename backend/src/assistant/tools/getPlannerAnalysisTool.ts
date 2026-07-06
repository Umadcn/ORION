/**
 * Read-only tool: fetch an existing Planner analysis by execution id (Phase 10).
 * Bounded summary only. Advisory — the deterministic RCA remains authoritative.
 */
import { getPlannerExecution } from '../../planner/plannerAuditRepository.js';
import type { ToolDefinition } from '../../copilot/types.js';

export const getPlannerAnalysisTool: ToolDefinition = {
  name: 'getPlannerAnalysis',
  description: 'Get a previously computed advisory Planner analysis by its execution ID.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 4000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['plannerExecutionId'],
    properties: { plannerExecutionId: { type: 'integer' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['found'],
    properties: { found: { type: 'boolean' } },
  },
  execute(args) {
    const id = Math.floor(Number(args.plannerExecutionId));
    const row = Number.isFinite(id) ? getPlannerExecution(id) : undefined;
    if (!row) return { found: false, plannerExecutionId: id };
    const e = row.execution as Record<string, unknown>;
    return {
      found: true,
      plannerExecutionId: e.id,
      investigationId: e.investigation_id,
      executionMode: e.execution_mode,
      planStatus: e.plan_status,
      objectiveSummary: e.objective_summary,
      groundingStatus: e.grounding_status,
      citationCount: e.citation_count,
      evidenceCount: e.evidence_count,
      advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY',
    };
  },
};
