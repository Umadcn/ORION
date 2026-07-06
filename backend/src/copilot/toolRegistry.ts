/**
 * Controlled, allowlisted, READ-ONLY tool registry (Phase 5).
 *
 * The registry is a fixed allowlist built at module load. Unknown tools fail
 * closed. There is NO dynamic module loading, NO arbitrary function execution,
 * NO arbitrary API/URL/SQL/filesystem access. Every registered tool is
 * read-only and carries its own input/output schemas + bounds.
 */
import type { JsonSchema } from '../llm/schema.js';
import type { ToolDefinition } from './types.js';
import { getSatelliteTool } from './tools/getSatellite.js';
import { getTelemetryTool } from './tools/getTelemetry.js';
import { getAlertsTool } from './tools/getAlerts.js';
import { getInvestigationTool } from './tools/getInvestigation.js';
import { getEvidenceTool } from './tools/getEvidence.js';
import { getReportTool } from './tools/getReport.js';
import { searchMissionKnowledgeTool } from './tools/searchMissionKnowledge.js';
import { searchHistoricalInvestigationsTool } from './tools/searchHistoricalInvestigations.js';

const TOOLS: ToolDefinition[] = [
  getSatelliteTool,
  getTelemetryTool,
  getAlertsTool,
  getInvestigationTool,
  getEvidenceTool,
  getReportTool,
  searchMissionKnowledgeTool,
  searchHistoricalInvestigationsTool,
];

// Freeze into an immutable allowlist keyed by name.
const REGISTRY: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((t) => [t.name, t]));

/** Resolve an allowlisted tool by exact name. Returns undefined (fail-closed) for unknown tools. */
export function getTool(name: string): ToolDefinition | undefined {
  if (typeof name !== 'string') return undefined;
  return REGISTRY.get(name);
}

export function isAllowedTool(name: string): boolean {
  return REGISTRY.has(name);
}

/** Non-secret tool catalog (for prompts + status). */
export function listTools(): { name: string; description: string; version: string; inputSchema: JsonSchema }[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, version: t.version, inputSchema: t.inputSchema }));
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
