/**
 * Strict structured-output schemas for the Mission Copilot LLM step (Phase 5).
 *
 * A single discriminated object (`type` = TOOL_REQUEST | FINAL_ANSWER) validated
 * with the Phase 1 JSON-Schema subset. Type-specific required fields are
 * enforced in code after schema validation (the subset has no oneOf). No hidden
 * chain-of-thought: only a short bounded `reasoning_summary` is permitted.
 */
import type { JsonSchema } from '../llm/schema.js';

export const COPILOT_STEP_SCHEMA_NAME = 'orion_copilot_step';

const stringArray: JsonSchema = { type: 'array', items: { type: 'string' } };

export const COPILOT_STEP_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['TOOL_REQUEST', 'FINAL_ANSWER'] },
    // TOOL_REQUEST fields
    reasoning_summary: { type: 'string' },
    tool_calls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tool_call_id', 'tool_name', 'arguments'],
        properties: {
          tool_call_id: { type: 'string' },
          tool_name: { type: 'string' },
          arguments: { type: 'object' },
        },
      },
    },
    // FINAL_ANSWER fields
    answer: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'citation_ids', 'evidence_ids'],
        properties: {
          claim: { type: 'string' },
          citation_ids: stringArray,
          evidence_ids: stringArray,
        },
      },
    },
    citations: stringArray,
    evidence_ids: stringArray,
    limitations: stringArray,
    suggested_followups: stringArray,
  },
};
