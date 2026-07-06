/**
 * ORION AI Assistant read-only tool registry (Phase 10).
 *
 * REUSES the frozen Phase 5 Copilot tool registry (8 tools) and ADDS four
 * controlled read-only tools (resolveCitation, getKnowledgeDocumentMetadata,
 * getPlannerAnalysis, getCriticReview). The heavier read-only WORKFLOW tools
 * (runPlannerAnalysis, runCriticReview, runValidatedInvestigationAnalysis) are
 * NOT generic tools — they are invoked by the bounded workflow service with
 * their own budgets and correlation linkage (see workflowService.ts).
 *
 * A fixed allowlist built at module load. Unknown tools fail closed. No dynamic
 * module loading, no arbitrary function/SQL/URL/filesystem access. Every tool is
 * read-only and carries its own schemas + bounds. It reuses the Phase 5
 * toolExecutor unchanged.
 */
import type { JsonSchema } from '../llm/schema.js';
import type { ToolDefinition } from '../copilot/types.js';
import { getSatelliteTool } from '../copilot/tools/getSatellite.js';
import { getTelemetryTool } from '../copilot/tools/getTelemetry.js';
import { getAlertsTool } from '../copilot/tools/getAlerts.js';
import { getInvestigationTool } from '../copilot/tools/getInvestigation.js';
import { getEvidenceTool } from '../copilot/tools/getEvidence.js';
import { getReportTool } from '../copilot/tools/getReport.js';
import { searchMissionKnowledgeTool } from '../copilot/tools/searchMissionKnowledge.js';
import { searchHistoricalInvestigationsTool } from '../copilot/tools/searchHistoricalInvestigations.js';
import { resolveCitationTool } from './tools/resolveCitationTool.js';
import { getKnowledgeDocumentMetadataTool } from './tools/getKnowledgeDocumentMetadataTool.js';
import { getPlannerAnalysisTool } from './tools/getPlannerAnalysisTool.js';
import { getCriticReviewTool } from './tools/getCriticReviewTool.js';

const TOOLS: ToolDefinition[] = [
  // Reused Phase 5 tools (unchanged).
  getSatelliteTool,
  getTelemetryTool,
  getAlertsTool,
  getInvestigationTool,
  getEvidenceTool,
  getReportTool,
  searchMissionKnowledgeTool,
  searchHistoricalInvestigationsTool,
  // New Phase 10 read-only tools.
  resolveCitationTool,
  getKnowledgeDocumentMetadataTool,
  getPlannerAnalysisTool,
  getCriticReviewTool,
];

const REGISTRY: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((t) => [t.name, t]));

/** Read-only workflow names invoked by the workflow service (not generic tools). */
export const ASSISTANT_WORKFLOW_NAMES = ['runPlannerAnalysis', 'runCriticReview', 'runValidatedInvestigationAnalysis'] as const;

export function getAssistantTool(name: string): ToolDefinition | undefined {
  if (typeof name !== 'string') return undefined;
  return REGISTRY.get(name);
}

export function isAllowedAssistantTool(name: string): boolean {
  return REGISTRY.has(name);
}

export function listAssistantTools(): { name: string; description: string; version: string; inputSchema: JsonSchema }[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, version: t.version, inputSchema: t.inputSchema }));
}

export const ASSISTANT_TOOL_NAMES = TOOLS.map((t) => t.name);
