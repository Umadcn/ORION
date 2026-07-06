/**
 * Deterministic offline planner (Phase 6). Builds a bounded, safe, read-only,
 * schema-valid investigation-analysis plan adapted to the investigation context.
 * Clearly labeled DETERMINISTIC_FALLBACK; runs through the same executor as a
 * real-provider plan.
 */
import { config } from '../config.js';
import { PLAN_VERSION } from './prompt.js';
import type { PlannerContext } from './plannerContext.js';
import type { InvestigationPlan, InvestigationPlanStep, PlanStepType } from './types.js';

export function buildDeterministicPlan(ctx: PlannerContext): InvestigationPlan {
  const invId = ctx.investigation.id;
  const satId = ctx.investigation.satellite_id;
  const steps: InvestigationPlanStep[] = [];
  let n = 0;
  const add = (step_type: PlanStepType, reason: string, parameters: Record<string, unknown>, depends_on: string[] = []): string => {
    const step_id = `STEP-${++n}`;
    steps.push({ step_id, step_type, reason, depends_on, parameters });
    return step_id;
  };

  const s1 = add('INSPECT_INVESTIGATION', 'Load the authoritative investigation state and root cause.', { investigationId: invId });
  const s2 = add('INSPECT_EVIDENCE', 'Gather the deterministic supporting evidence.', { investigationId: invId }, [s1]);
  if (ctx.satellite) add('INSPECT_SATELLITE', 'Inspect current satellite state.', { satelliteId: satId }, [s1]);
  add('INSPECT_TELEMETRY', 'Review the most recent telemetry window.', { satelliteId: satId, limit: 5 }, [s1]);
  add('INSPECT_ALERTS', 'Review recent alerts for context.', { satelliteId: satId, limit: 10 }, [s1]);
  const sk = add('SEARCH_MISSION_KNOWLEDGE', 'Find mission documentation relevant to the root cause.', { query: `${(ctx.investigation.root_cause ?? '').replace(/_/g, ' ')} ${ctx.subsystem ?? ''}`.trim(), topK: 5 }, [s1]);
  add('SEARCH_HISTORICAL_INVESTIGATIONS', 'Look for similar past incidents.', { query: `${satId} ${(ctx.investigation.root_cause ?? '').replace(/_/g, ' ')}`.trim(), limit: 5 }, [s1]);
  if (ctx.hasReport) add('INSPECT_REPORT', 'Review the existing investigation report.', { investigationId: invId }, [s1]);
  const sg = add('ASSESS_KNOWLEDGE_GAP', 'Check whether gathered context is sufficient; retrieve more if needed.', {}, [s2, sk]);
  add('BUILD_FINAL_ANALYSIS', 'Compose the grounded read-only investigation analysis.', {}, [sg]);

  // Never exceed the configured step bound.
  const bounded = steps.slice(0, config.planner.maxSteps);
  return {
    plan_version: PLAN_VERSION,
    objective: `Read-only analysis of investigation ${invId} on ${satId}.`,
    steps: bounded,
    completion_criteria: ['authoritative root cause reviewed', 'supporting evidence gathered', 'relevant mission knowledge retrieved', 'knowledge gaps assessed'],
  };
}
