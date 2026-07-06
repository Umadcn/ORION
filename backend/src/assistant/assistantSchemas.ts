/**
 * Strict structured-output schemas for the ORION AI Assistant (Phase 10),
 * validated with the Phase 1 JSON-Schema subset (object/array/string/number/
 * integer/boolean/null, required, properties, items, enum, additionalProperties,
 * minItems, nullable — no maxItems/maxLength/oneOf). Type-specific constraints
 * are enforced in code after schema validation.
 */
import type { JsonSchema } from '../llm/schema.js';

const stringArray: JsonSchema = { type: 'array', items: { type: 'string' } };

// --- Intent classification (real-provider structured routing) --------------

export const ASSISTANT_INTENT_SCHEMA_NAME = 'orion_assistant_intent';

export const ASSISTANT_INTENT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent'],
  properties: {
    intent: {
      type: 'string',
      enum: [
        'GREETING', 'THANKS', 'CAPABILITIES', 'OUT_OF_SCOPE', 'CLARIFICATION_NEEDED',
        'SATELLITE_LOOKUP', 'TELEMETRY_COMPARISON',
        'MISSION_QA', 'SATELLITE_STATUS', 'TELEMETRY_ANALYSIS', 'ALERT_ANALYSIS',
        'INVESTIGATION_EXPLANATION', 'EVIDENCE_EXPLANATION', 'REPORT_EXPLANATION',
        'MISSION_KNOWLEDGE_SEARCH', 'HISTORICAL_INCIDENT_SEARCH', 'SIMILAR_INCIDENT_ANALYSIS',
        'PLANNER_ANALYSIS', 'CRITIC_REVIEW', 'VALIDATED_INVESTIGATION_ANALYSIS',
        'SOURCE_INSPECTION', 'FOLLOW_UP', 'PROHIBITED', 'UNSUPPORTED',
      ],
    },
    // Entity references the classifier may extract (validated against authoritative data downstream).
    satellite_id: { type: 'string', nullable: true },
    investigation_id: { type: 'integer', nullable: true },
    report_id: { type: 'integer', nullable: true },
    citation_id: { type: 'string', nullable: true },
    citation_ordinal: { type: 'integer', nullable: true },
    references_previous: { type: 'boolean', nullable: true },
  },
};

// --- Real-provider bounded tool-calling step -------------------------------
// A single discriminated object (type = TOOL_REQUEST | FINAL_ANSWER). No hidden
// chain-of-thought: only a short bounded reasoning_summary is permitted.

export const ASSISTANT_STEP_SCHEMA_NAME = 'orion_assistant_step';

export const ASSISTANT_STEP_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['TOOL_REQUEST', 'FINAL_ANSWER'] },
    reasoning_summary: { type: 'string' },
    // TOOL_REQUEST
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
    // FINAL_ANSWER
    title: { type: 'string' },
    summary: { type: 'string' },
    answer: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'body'],
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'citation_ids', 'evidence_ids'],
        properties: { claim: { type: 'string' }, citation_ids: stringArray, evidence_ids: stringArray },
      },
    },
    citations: stringArray,
    evidence_ids: stringArray,
    workflow_references: stringArray,
    limitations: stringArray,
    suggested_followups: stringArray,
  },
};

// --- Bounded conversation summary ------------------------------------------

export const ASSISTANT_SUMMARY_SCHEMA_NAME = 'orion_assistant_summary';

export const ASSISTANT_SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: { summary: { type: 'string' } },
};

// --- Structured assistant answer -------------------------------------------

export const ASSISTANT_ANSWER_SCHEMA_NAME = 'orion_assistant_answer';

export const ASSISTANT_ANSWER_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer_version', 'title', 'summary', 'claims', 'citations', 'evidence_ids'],
  properties: {
    answer_version: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'body'],
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'citation_ids', 'evidence_ids'],
        properties: { claim: { type: 'string' }, citation_ids: stringArray, evidence_ids: stringArray },
      },
    },
    citations: stringArray,
    evidence_ids: stringArray,
    workflow_references: stringArray,
    limitations: stringArray,
    suggested_followups: stringArray,
  },
};
