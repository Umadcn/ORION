/**
 * Planner read-only Action Registry (Phase 6).
 *
 * A fixed, frozen mapping from plan step types to the existing Phase 5 read-only
 * Copilot tools (reused — no duplicated business logic). ASSESS_KNOWLEDGE_GAP and
 * BUILD_FINAL_ANALYSIS are internal deterministic planner operations (no tool).
 * Unknown/unmapped step types fail closed.
 */
import type { PlanStepType } from './types.js';
import { isAllowedTool } from '../copilot/toolRegistry.js';

const STEP_TO_TOOL: ReadonlyMap<PlanStepType, string> = new Map([
  ['INSPECT_SATELLITE', 'getSatellite'],
  ['INSPECT_TELEMETRY', 'getTelemetry'],
  ['INSPECT_ALERTS', 'getAlerts'],
  ['INSPECT_INVESTIGATION', 'getInvestigation'],
  ['INSPECT_EVIDENCE', 'getEvidence'],
  ['SEARCH_MISSION_KNOWLEDGE', 'searchMissionKnowledge'],
  ['SEARCH_HISTORICAL_INVESTIGATIONS', 'searchHistoricalInvestigations'],
  ['INSPECT_REPORT', 'getReport'],
]);

const INTERNAL_STEPS: ReadonlySet<PlanStepType> = new Set(['ASSESS_KNOWLEDGE_GAP', 'BUILD_FINAL_ANALYSIS']);

/** Resolve the read-only Copilot tool for a step type, or null if internal/unknown. */
export function toolForStep(stepType: PlanStepType): string | null {
  const name = STEP_TO_TOOL.get(stepType);
  if (!name) return null;
  // Defense-in-depth: the mapped tool must exist in the frozen Copilot allowlist.
  return isAllowedTool(name) ? name : null;
}

export function isInternalStep(stepType: PlanStepType): boolean {
  return INTERNAL_STEPS.has(stepType);
}

export function isKnownStepType(stepType: string): boolean {
  return STEP_TO_TOOL.has(stepType as PlanStepType) || INTERNAL_STEPS.has(stepType as PlanStepType);
}
