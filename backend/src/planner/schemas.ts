/**
 * Strict structured-output schema for a Planner-generated investigation plan
 * (Phase 6). Uses the Phase 1 JSON-Schema subset. Bounds/uniqueness/cycle/safety
 * checks that the subset cannot express are enforced by planValidator.
 */
import type { JsonSchema } from '../llm/schema.js';
import { PLAN_STEP_TYPES } from './types.js';

export const PLAN_SCHEMA_NAME = 'orion_investigation_plan';

export const PLAN_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plan_version', 'objective', 'steps', 'completion_criteria'],
  properties: {
    plan_version: { type: 'string' },
    objective: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step_id', 'step_type', 'reason', 'depends_on', 'parameters'],
        properties: {
          step_id: { type: 'string' },
          step_type: { type: 'string', enum: [...PLAN_STEP_TYPES] },
          reason: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
          parameters: { type: 'object' },
        },
      },
    },
    completion_criteria: { type: 'array', items: { type: 'string' } },
  },
};
