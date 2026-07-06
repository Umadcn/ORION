/**
 * Strict structured-output schemas for the Critic (Phase 7). Uses the Phase 1
 * JSON-Schema subset. Bounds/uniqueness/allowlist/safety checks the subset
 * cannot express (array lengths, string lengths, unique IDs, in-context ID
 * membership, decision consistency) are enforced by criticValidators.
 */
import type { JsonSchema } from '../llm/schema.js';
import { CRITIQUE_CATEGORIES, CRITIQUE_SEVERITIES } from './types.js';

export const CRITIC_REVIEW_SCHEMA_NAME = 'orion_planner_critic_review';

export const CRITIC_REVIEW_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['review_version', 'decision', 'summary', 'issues', 'coverage', 'revision_instructions', 'limitations'],
  properties: {
    review_version: { type: 'string' },
    decision: { type: 'string', enum: ['ACCEPT', 'REVISE', 'REJECT'] },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue_id', 'severity', 'category', 'description', 'claim_index', 'citation_ids', 'evidence_ids', 'recommended_correction'],
        properties: {
          issue_id: { type: 'string' },
          severity: { type: 'string', enum: [...CRITIQUE_SEVERITIES] },
          category: { type: 'string', enum: [...CRITIQUE_CATEGORIES] },
          description: { type: 'string' },
          claim_index: { type: 'integer', nullable: true },
          citation_ids: { type: 'array', items: { type: 'string' } },
          evidence_ids: { type: 'array', items: { type: 'string' } },
          recommended_correction: { type: 'string' },
        },
      },
    },
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['investigation_context', 'deterministic_evidence', 'telemetry', 'alerts', 'mission_knowledge', 'historical_incidents', 'limitations', 'knowledge_gaps'],
      properties: {
        investigation_context: { type: 'boolean' },
        deterministic_evidence: { type: 'boolean' },
        telemetry: { type: 'boolean' },
        alerts: { type: 'boolean' },
        mission_knowledge: { type: 'boolean' },
        historical_incidents: { type: 'boolean' },
        limitations: { type: 'boolean' },
        knowledge_gaps: { type: 'boolean' },
      },
    },
    revision_instructions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['instruction_id', 'target', 'action', 'reason'],
        properties: {
          instruction_id: { type: 'string' },
          target: { type: 'string' },
          action: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Schema for a (possibly revised) PlannerAnalysis — used to schema-validate the
 * output of the deterministic RevisionService before the Critic re-evaluates it.
 * Mirrors the Phase 6 PlannerAnalysis shape.
 */
export const ANALYSIS_SCHEMA_NAME = 'orion_planner_analysis';

export const ANALYSIS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'objective', 'authoritative_root_cause', 'analysis_summary', 'findings', 'knowledge_gaps', 'recommended_review_items', 'limitations'],
  properties: {
    title: { type: 'string' },
    objective: { type: 'string' },
    authoritative_root_cause: { type: 'string' },
    analysis_summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'source_types', 'citation_ids', 'evidence_ids'],
        properties: {
          claim: { type: 'string' },
          source_types: { type: 'array', items: { type: 'string', enum: ['TOOL_FACT', 'EVIDENCE', 'MISSION_KNOWLEDGE'] } },
          citation_ids: { type: 'array', items: { type: 'string' } },
          evidence_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    knowledge_gaps: { type: 'array', items: { type: 'string' } },
    recommended_review_items: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'array', items: { type: 'string' } },
  },
};
