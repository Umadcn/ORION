/**
 * Reusable quality gate (Phase 4). Deterministic decision with documented
 * precedence. Real-provider output and deterministic-fallback output are run
 * through the SAME validation pipeline — there is no provider-specific bypass
 * and no hidden acceptance path.
 *
 * Precedence (first failing check wins):
 *   1. context sufficiency   -> REJECT_CONTEXT_INSUFFICIENT
 *   2. schema                -> REJECT_SCHEMA
 *   3. citations             -> REJECT_INVALID_CITATION
 *   4. evidence              -> REJECT_INVALID_EVIDENCE
 *   5. grounding             -> REJECT_UNGROUNDED
 *   6. policy                -> REJECT_POLICY
 *   otherwise                -> ACCEPT
 */
import type {
  CitationValidationResult,
  ContextSufficiencyResult,
  EvidenceValidationResult,
  GroundingValidationResult,
  PolicyValidationResult,
  QualityGateResult,
  SchemaValidationResult,
} from './types.js';

export interface QualityGateInput {
  sufficiency: ContextSufficiencyResult;
  schema: SchemaValidationResult;
  citation: CitationValidationResult;
  evidence: EvidenceValidationResult;
  grounding: GroundingValidationResult;
  policy: PolicyValidationResult;
}

export function runQualityGate(input: QualityGateInput): QualityGateResult {
  const base = {
    schema: input.schema,
    citation: input.citation,
    evidence: input.evidence,
    grounding: input.grounding,
    policy: input.policy,
    sufficiency: input.sufficiency,
  };
  if (!input.sufficiency.sufficient) return { decision: 'REJECT_CONTEXT_INSUFFICIENT', ...base };
  if (!input.schema.valid) return { decision: 'REJECT_SCHEMA', ...base };
  if (!input.citation.valid) return { decision: 'REJECT_INVALID_CITATION', ...base };
  if (!input.evidence.valid) return { decision: 'REJECT_INVALID_EVIDENCE', ...base };
  if (!input.grounding.valid) return { decision: 'REJECT_UNGROUNDED', ...base };
  if (!input.policy.valid) return { decision: 'REJECT_POLICY', ...base };
  return { decision: 'ACCEPT', ...base };
}
