/**
 * Critic output validation (Phase 7). Fail-closed.
 *
 * Validates a CriticReview (real or deterministic) against: schema, issue/array
 * bounds, unique issue + revision-instruction IDs, allowlisted categories /
 * severities / revision targets, in-context citation & evidence IDs, no
 * fabricated satellite/investigation/report IDs in text, no operational commands
 * / write actions / SQL / URL / filesystem paths / secrets, and decision
 * consistency with issue severities.
 *
 * Also validates a (revised) PlannerAnalysis via the reused Phase 5/6 grounding
 * + policy validators plus exact authoritative-RCA preservation.
 */
import { config } from '../config.js';
import { validateJsonSchema } from '../llm/schema.js';
import { validateCopilotAnswer } from '../copilot/copilotValidators.js';
import type { CopilotGroundingContext } from '../copilot/types.js';
import { CRITIC_REVIEW_SCHEMA, ANALYSIS_SCHEMA } from './schemas.js';
import { analysisToAnswer, stableHash } from './criticGrounding.js';
import { CRITIQUE_CATEGORIES, CRITIQUE_SEVERITIES, REVISION_TARGETS } from './types.js';
import { issueSeverities } from './deterministicCritic.js';
import type { CriticContext, CriticReview } from './types.js';
import type { PlannerAnalysis } from '../planner/types.js';

const UNSAFE_TEXT = [
  /\b(approve|reject|resolve|delete|update|insert|drop table|reset the simulation|inject|uplink|transmit|shutdown|shut down|fire thrusters?)\b/i,
  /\b(select\s+.*\s+from\s+\w+|from\s+\w+\s+where|;--)/i,
  /(https?:\/\/|file:\/\/|\.\.\/|\/etc\/|c:\\)/i,
];
const SECRET = [/\bsk-[A-Za-z0-9]{8,}\b/, /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i];
const MAX_STR = 800;

export interface CriticReviewValidation {
  valid: boolean;
  errors: string[];
  decisionConsistent: boolean;
}

/** Collect every free-text field in the review for safety scanning. */
function reviewText(r: CriticReview): string {
  return [r.summary, ...r.limitations, ...r.issues.flatMap((i) => [i.description, i.recommended_correction]), ...r.revision_instructions.flatMap((v) => [v.action, v.reason])].join('\n');
}

export function validateCriticReview(review: CriticReview, ctx: CriticContext, grounding: CopilotGroundingContext): CriticReviewValidation {
  const errors: string[] = [];

  const schema = validateJsonSchema(CRITIC_REVIEW_SCHEMA, review);
  if (!schema.valid) return { valid: false, errors: schema.errors, decisionConsistent: false };

  if (review.review_version !== 'orion-planner-critic-v1') errors.push('unexpected review_version');
  if (review.issues.length > config.critic.maxIssues) errors.push(`too many issues (max ${config.critic.maxIssues})`);
  if (review.revision_instructions.length > config.critic.maxIssues) errors.push('too many revision_instructions');
  if (review.summary.length > MAX_STR) errors.push('summary too long');

  // Unique IDs + allowlists + bounded strings + in-context IDs.
  const issueIds = new Set<string>();
  for (const i of review.issues) {
    if (issueIds.has(i.issue_id)) errors.push(`duplicate issue_id ${i.issue_id}`);
    issueIds.add(i.issue_id);
    if (!CRITIQUE_SEVERITIES.includes(i.severity)) errors.push(`bad severity ${i.severity}`);
    if (!CRITIQUE_CATEGORIES.includes(i.category)) errors.push(`bad category ${i.category}`);
    if (i.description.length > MAX_STR || i.recommended_correction.length > MAX_STR) errors.push(`issue ${i.issue_id} text too long`);
    if (i.claim_index !== null && (i.claim_index < 0 || i.claim_index >= ctx.analysis.findings.length)) errors.push(`issue ${i.issue_id} claim_index out of range`);
    for (const cid of i.citation_ids) if (!grounding.allowedCitationIds.has(cid)) errors.push(`issue ${i.issue_id} references out-of-context citation ${cid}`);
    for (const eid of i.evidence_ids) if (!grounding.allowedEvidenceIds.has(eid)) errors.push(`issue ${i.issue_id} references out-of-context evidence ${eid}`);
  }

  const revIds = new Set<string>();
  for (const v of review.revision_instructions) {
    if (revIds.has(v.instruction_id)) errors.push(`duplicate instruction_id ${v.instruction_id}`);
    revIds.add(v.instruction_id);
    if (!REVISION_TARGETS.includes(v.target as (typeof REVISION_TARGETS)[number])) errors.push(`non-allowlisted revision target ${v.target}`);
    if (v.action.length > MAX_STR || v.reason.length > MAX_STR) errors.push(`instruction ${v.instruction_id} text too long`);
  }

  // Safety: no operational/write/SQL/URL/path/secret content anywhere in the review.
  const text = reviewText(review);
  if (UNSAFE_TEXT.some((re) => re.test(text))) errors.push('review text contains prohibited (operational/write/SQL/URL/path) content');
  if (SECRET.some((re) => re.test(text))) errors.push('review text contains a secret-shaped string');

  // Fabricated IDs referenced in review text.
  for (const raw of text.match(/\bORION-\d+\b/gi) ?? []) if (!new Set(ctx.knownSatelliteIdsUpper).has(raw.toUpperCase())) errors.push(`review references unknown satellite ${raw}`);
  for (const raw of text.match(/ORION-KB-[A-Z0-9-]+/gi) ?? []) if (!grounding.allowedCitationIds.has(raw)) errors.push(`review references unknown citation ${raw}`);

  const decisionConsistent = isDecisionConsistent(review);
  if (!decisionConsistent) errors.push(`decision ${review.decision} inconsistent with issue severities`);

  return { valid: errors.length === 0, errors, decisionConsistent };
}

/**
 * Decision consistency precedence (documented):
 *   ACCEPT  → no ERROR and no CRITICAL issues.
 *   REVISE  → at least one issue and NO CRITICAL issue.
 *   REJECT  → at least one CRITICAL issue.
 */
export function isDecisionConsistent(review: CriticReview): boolean {
  const s = issueSeverities(review);
  switch (review.decision) {
    case 'ACCEPT': return s.criticalCount === 0 && s.errorCount === 0;
    case 'REVISE': return s.criticalCount === 0 && review.issues.length > 0;
    case 'REJECT': return s.criticalCount > 0;
    default: return false;
  }
}

export interface AnalysisValidation {
  valid: boolean;
  errors: string[];
  citationValid: boolean;
  evidenceValid: boolean;
  groundingValid: boolean;
  policyValid: boolean;
  rootCauseMatches: boolean;
}

/** Validate a (possibly revised) PlannerAnalysis through the full pipeline. */
export function validateRevisedAnalysis(analysis: PlannerAnalysis, ctx: CriticContext, grounding: CopilotGroundingContext): AnalysisValidation {
  const errors: string[] = [];
  const schema = validateJsonSchema(ANALYSIS_SCHEMA, analysis);
  if (!schema.valid) return { valid: false, errors: schema.errors, citationValid: false, evidenceValid: false, groundingValid: false, policyValid: false, rootCauseMatches: false };

  const rootCauseMatches = analysis.authoritative_root_cause === ctx.authoritativeRootCause;
  if (!rootCauseMatches) errors.push('authoritative_root_cause was altered');

  const cop = validateCopilotAnswer(analysisToAnswer(analysis), grounding);
  if (!cop.citationValid) errors.push('revised analysis has invalid citations');
  if (!cop.evidenceValid) errors.push('revised analysis has invalid evidence');
  if (!cop.groundingValid) errors.push('revised analysis has ungrounded claims');
  if (!cop.policyValid) errors.push('revised analysis has a policy violation');

  return {
    valid: errors.length === 0,
    errors,
    citationValid: cop.citationValid,
    evidenceValid: cop.evidenceValid,
    groundingValid: cop.groundingValid,
    policyValid: cop.policyValid,
    rootCauseMatches,
  };
}

/** Convenience re-export so callers hash analyses/reviews consistently. */
export { stableHash };
