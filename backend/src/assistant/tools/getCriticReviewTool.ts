/**
 * Read-only tool: fetch an existing Critic review by execution id (Phase 10).
 * ACCEPT/REVISE/REJECT are analysis-quality review only — NEVER a mission
 * decision. humanReviewRequired is preserved.
 */
import { getCriticExecution } from '../../critic/criticAuditRepository.js';
import type { ToolDefinition } from '../../copilot/types.js';

export const getCriticReviewTool: ToolDefinition = {
  name: 'getCriticReview',
  description: 'Get a previously computed advisory Critic review by its execution ID.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 4000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['criticExecutionId'],
    properties: { criticExecutionId: { type: 'integer' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['found'],
    properties: { found: { type: 'boolean' } },
  },
  execute(args) {
    const id = Math.floor(Number(args.criticExecutionId));
    const row = Number.isFinite(id) ? getCriticExecution(id) : undefined;
    if (!row) return { found: false, criticExecutionId: id };
    const e = row.execution as Record<string, unknown>;
    return {
      found: true,
      criticExecutionId: e.id,
      plannerExecutionId: e.planner_execution_id,
      investigationId: e.investigation_id,
      executionMode: e.execution_mode,
      criticStatus: e.critic_status,
      initialDecision: e.initial_decision,
      finalDecision: e.final_decision,
      issueCount: e.issue_count,
      contradictionCount: e.contradiction_count,
      humanReviewRequired: true,
      advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY',
    };
  },
};
