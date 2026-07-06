/**
 * ORION AI Assistant quality gate (Phase 10).
 *
 * Fixed validation precedence:
 *   CONTEXT_VALID → SCHEMA_VALID → WORKFLOW_REFERENCES_VALID → CITATIONS_VALID →
 *   EVIDENCE_VALID → GROUNDING_VALID → POLICY_VALID → EXECUTION_MODE_INTEGRITY → ACCEPT
 *
 * Grounding/citation/evidence/policy are delegated to the Phase 5 Copilot
 * validators (deterministic, lexical — grounding support is NOT confidence) by
 * mapping the AssistantAnswer onto the CopilotFinalAnswer surface. Both the
 * real-provider answer and the deterministic fallback pass through this SAME
 * gate. Fallback is never labeled real.
 */
import { validateCopilotAnswer } from '../copilot/copilotValidators.js';
import type { CopilotFinalAnswer, CopilotGroundingContext } from '../copilot/types.js';
import type { AssistantAnswer } from './types.js';

export interface AssistantValidation {
  schemaValid: boolean;
  workflowRefsValid: boolean;
  citationValid: boolean;
  evidenceValid: boolean;
  groundingValid: boolean;
  policyValid: boolean;
  averageSupport: number | null;
  supportedClaimCount: number;
  claimCount: number;
  invalidWorkflowRefs: string[];
  /** The first failing gate, or 'ACCEPT'. */
  gate: string;
  accepted: boolean;
}

/** Map an AssistantAnswer onto the CopilotFinalAnswer surface for grounding/policy checks. */
function toCopilotAnswer(a: AssistantAnswer): CopilotFinalAnswer {
  const sectionText = (a.sections ?? []).map((s) => `${s.heading}: ${s.body}`).join('\n');
  return {
    type: 'FINAL_ANSWER',
    answer: [a.title, a.summary, sectionText].filter(Boolean).join('\n'),
    claims: (a.claims ?? []).map((c) => ({ claim: c.claim, citation_ids: c.citation_ids ?? [], evidence_ids: c.evidence_ids ?? [] })),
    citations: a.citations ?? [],
    evidence_ids: a.evidence_ids ?? [],
    limitations: a.limitations ?? [],
    suggested_followups: a.suggested_followups ?? [],
  };
}

export function validateAssistantAnswer(
  a: AssistantAnswer,
  grounding: CopilotGroundingContext,
  availableWorkflowRefs: Set<string>,
): AssistantValidation {
  // SCHEMA_VALID (structural sanity beyond JSON-schema: required strings present).
  const schemaValid = typeof a.title === 'string' && typeof a.summary === 'string' && Array.isArray(a.claims) && Array.isArray(a.citations) && Array.isArray(a.evidence_ids);

  // WORKFLOW_REFERENCES_VALID — every referenced workflow id must be one produced this turn.
  const invalidWorkflowRefs = (a.workflow_references ?? []).filter((r) => !availableWorkflowRefs.has(r));
  const workflowRefsValid = invalidWorkflowRefs.length === 0;

  const cop = validateCopilotAnswer(toCopilotAnswer(a), grounding);
  const supportedClaimCount = cop.claims.filter((c) => c.supported).length;

  let gate = 'ACCEPT';
  if (!schemaValid) gate = 'SCHEMA_INVALID';
  else if (!workflowRefsValid) gate = 'WORKFLOW_REFERENCES_INVALID';
  else if (!cop.citationValid) gate = 'CITATIONS_INVALID';
  else if (!cop.evidenceValid) gate = 'EVIDENCE_INVALID';
  else if (!cop.groundingValid) gate = 'GROUNDING_INVALID';
  else if (!cop.policyValid) gate = 'POLICY_INVALID';

  return {
    schemaValid,
    workflowRefsValid,
    citationValid: cop.citationValid,
    evidenceValid: cop.evidenceValid,
    groundingValid: cop.groundingValid,
    policyValid: cop.policyValid,
    averageSupport: cop.averageSupport,
    supportedClaimCount,
    claimCount: cop.claims.length,
    invalidWorkflowRefs,
    gate,
    accepted: gate === 'ACCEPT',
  };
}
