/**
 * Deterministic plan validation (Phase 6). Fail-closed.
 *
 * Validates schema, bounds, unique step IDs, allowlisted step types, dependency
 * validity + cycle detection, ID consistency (no fabrication), and safety
 * (no write/operational vocabulary, no arbitrary tools/SQL/URL/filesystem paths,
 * bounded text/parameters).
 */
import { config } from '../config.js';
import { validateJsonSchema } from '../llm/schema.js';
import { PLAN_SCHEMA } from './schemas.js';
import { isKnownStepType } from './actionRegistry.js';
import type { InvestigationPlan } from './types.js';

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

const UNSAFE_VOCAB = [
  /\b(approve|reject|resolve|delete|update|insert|drop|reset|inject|uplink|transmit|shutdown|shut down|fire)\b/i,
  /\b(select\s|from\s+\w+\s+where|;--)/i,
  /(https?:\/\/|file:\/\/|\.\.\/|\/etc\/|c:\\)/i,
];
const MAX_REASON = 400;
const MAX_OBJECTIVE = 500;
const MAX_PARAM_CHARS = 1000;

export function validatePlan(plan: InvestigationPlan, expected: { investigationId: number; satelliteId: string }): PlanValidationResult {
  const errors: string[] = [];

  const schema = validateJsonSchema(PLAN_SCHEMA, plan);
  if (!schema.valid) return { valid: false, errors: schema.errors };

  if (plan.objective.length > MAX_OBJECTIVE) errors.push('objective too long');
  if (plan.steps.length === 0) errors.push('plan has no steps');
  if (plan.steps.length > config.planner.maxSteps) errors.push(`too many steps (max ${config.planner.maxSteps})`);

  const ids = new Set<string>();
  const seen: string[] = [];
  for (const s of plan.steps) {
    if (ids.has(s.step_id)) errors.push(`duplicate step_id: ${s.step_id}`);
    ids.add(s.step_id);
    if (!isKnownStepType(s.step_type)) errors.push(`unknown step_type: ${s.step_type}`);
    if (s.reason.length > MAX_REASON) errors.push(`step ${s.step_id} reason too long`);
    const paramStr = JSON.stringify(s.parameters ?? {});
    if (paramStr.length > MAX_PARAM_CHARS) errors.push(`step ${s.step_id} parameters too large`);
    if (UNSAFE_VOCAB.some((re) => re.test(paramStr))) errors.push(`step ${s.step_id} parameters contain prohibited content`);
    if (UNSAFE_VOCAB.some((re) => re.test(s.reason))) errors.push(`step ${s.step_id} reason contains prohibited content`);

    // Fabricated ID checks in parameters.
    const invParam = (s.parameters as { investigationId?: unknown })?.investigationId;
    if (invParam !== undefined && Number(invParam) !== expected.investigationId) errors.push(`step ${s.step_id} references a foreign investigation id`);
    const satParam = (s.parameters as { satelliteId?: unknown })?.satelliteId;
    if (typeof satParam === 'string' && satParam.toUpperCase() !== expected.satelliteId.toUpperCase()) errors.push(`step ${s.step_id} references a foreign satellite id`);
    seen.push(s.step_id);
  }

  // Dependency validity + no forward deps + cycle detection (deps must precede).
  const priorIds = new Set<string>();
  for (const s of plan.steps) {
    for (const dep of s.depends_on ?? []) {
      if (!ids.has(dep)) errors.push(`step ${s.step_id} depends on unknown ${dep}`);
      else if (!priorIds.has(dep)) errors.push(`step ${s.step_id} has a forward/self dependency on ${dep}`);
    }
    priorIds.add(s.step_id);
  }
  if (UNSAFE_VOCAB.some((re) => re.test(plan.objective))) errors.push('objective contains prohibited content');

  return { valid: errors.length === 0, errors };
}
