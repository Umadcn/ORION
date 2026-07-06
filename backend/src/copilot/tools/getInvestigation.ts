/** Read-only tool: deterministic investigation state + RCA summary + recommendations. */
import { getInvestigation as getInv, getRecommendations } from '../../services/investigationService.js';
import type { ToolDefinition } from '../types.js';

export const getInvestigationTool: ToolDefinition = {
  name: 'getInvestigation',
  description: 'Get an investigation\'s deterministic root cause, severity, status, and recommended review actions.',
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
    required: ['found'],
    properties: { found: { type: 'boolean' } },
  },
  execute(args) {
    const id = Math.floor(Number(args.investigationId));
    const investigation = Number.isFinite(id) ? getInv(id) : undefined;
    if (!investigation) return { found: false, investigationId: id };
    let anomalies: string[] = [];
    try { anomalies = JSON.parse(investigation.detected_anomalies) as string[]; } catch { anomalies = []; }
    return {
      found: true,
      id: investigation.id,
      satellite_id: investigation.satellite_id,
      status: investigation.status,
      severity: investigation.severity,
      authoritative_root_cause: investigation.root_cause,
      deterministic_confidence: investigation.confidence, // RCA confidence, NOT grounding
      explanation: investigation.explanation,
      detected_anomalies: anomalies,
      recommended_review_actions: getRecommendations(id).map((r) => ({ action: r.action, rationale: r.rationale, priority: r.priority })),
    };
  },
};
