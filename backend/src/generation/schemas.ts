/**
 * Strict structured-output schema for the GeneratedBriefing (Phase 4).
 *
 * Uses the Phase 1 dependency-free JSON-Schema subset (object/array/string/
 * required/items/additionalProperties). Array/string MAX bounds are enforced by
 * the policy validator (the subset supports minItems but not maxItems/maxLength);
 * see policyValidator + config bounds.
 *
 * The schema deliberately has NO fields for operational commands, autonomous
 * actions, or approve/reject/resolve decisions.
 */
import type { JsonSchema } from '../llm/schema.js';

const citationIds: JsonSchema = { type: 'array', items: { type: 'string' } };

export const BRIEFING_SCHEMA_NAME = 'orion_investigation_briefing';

export const BRIEFING_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'situation', 'root_cause', 'evidence_summary', 'recommended_review_items', 'limitations'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    situation: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'citation_ids'],
        properties: { claim: { type: 'string' }, citation_ids: citationIds },
      },
    },
    root_cause: {
      type: 'object',
      additionalProperties: false,
      required: ['authoritative_root_cause', 'explanation', 'citation_ids'],
      properties: {
        authoritative_root_cause: { type: 'string' },
        explanation: { type: 'string' },
        citation_ids: citationIds,
      },
    },
    evidence_summary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidence_ids', 'citation_ids'],
        properties: {
          claim: { type: 'string' },
          evidence_ids: { type: 'array', items: { type: 'string' } },
          citation_ids: citationIds,
        },
      },
    },
    recommended_review_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'citation_ids'],
        properties: { item: { type: 'string' }, citation_ids: citationIds },
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
};
