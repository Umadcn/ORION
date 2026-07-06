/**
 * Copilot answer validation (Phase 5). Reuses the Phase 4 grounding philosophy:
 * deterministic, lexical, bounded. A factual claim is grounded when it either
 * has lexical support in a cited (in-context, resolvable) knowledge chunk OR
 * references a valid in-context evidence ID. No score is labeled confidence.
 */
import { config } from '../config.js';
import { isValidCitationId } from '../knowledge/citations.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import { tokenize } from '../retrieval/tokenize.js';
import type { CopilotFinalAnswer, CopilotGroundingContext } from './types.js';

function expand(tokens: string[]): Set<string> {
  const s = new Set<string>();
  for (const t of tokens) { s.add(t); for (const p of t.split(/[-_]/).filter(Boolean)) s.add(p); }
  return s;
}
function significant(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(text, { maxTokens: 256 })) if (t.length >= 3 && !seen.has(t)) { seen.add(t); out.push(t); }
  return out;
}

export interface PerClaim { claim: string; supportScore: number; supported: boolean; reason: string | null; }
export interface CopilotValidation {
  citationValid: boolean;
  evidenceValid: boolean;
  groundingValid: boolean;
  policyValid: boolean;
  invalidCitationIds: string[];
  invalidEvidenceIds: string[];
  claims: PerClaim[];
  supportedClaimCount: number;
  averageSupport: number | null;
  policyViolations: { code: string; detail: string }[];
}

const COMMAND = [/\b(uplink|transmit|send)\s+(a\s+)?command/i, /\bexecute\s*:/i, /\bfire\s+thrusters?\b/i, /\b(power|shut)\s*(off|down)\s+the\s+(satellite|spacecraft|payload)\b/i, /\b(reset|start|stop|pause|resume)\s+the\s+simulation\b/i, /\b(inject|remove|clear)\b[^.]*\bfailure\b/i];
const ACTION = [/\b(has|have|was|were)\s+(been\s+)?(executed|commanded|uplinked|transmitted|activated|deactivated|reset)\b/i, /\b(i|we)\s+(have\s+)?(executed|commanded|sent|reset|approved|rejected|resolved)\b/i];
const DECISION = [/\b(approved|rejected|resolved)\b[^.]*\binvestigation\b/i, /\bdecision\s*:\s*(approve|reject|resolve)/i];
const SECRET = [/\bsk-[A-Za-z0-9]{8,}\b/, /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i];

function collectCitationIds(a: CopilotFinalAnswer): string[] {
  return [...(a.citations ?? []), ...(a.claims ?? []).flatMap((c) => c.citation_ids ?? [])];
}
function collectEvidenceIds(a: CopilotFinalAnswer): string[] {
  return [...(a.evidence_ids ?? []), ...(a.claims ?? []).flatMap((c) => c.evidence_ids ?? [])];
}

export function validateCopilotAnswer(a: CopilotFinalAnswer, ctx: CopilotGroundingContext): CopilotValidation {
  const threshold = config.generation.minGroundingSupport;

  // Citations
  const invalidCitationIds: string[] = [];
  for (const id of collectCitationIds(a)) {
    if (!isValidCitationId(id) || !ctx.allowedCitationIds.has(id) || !resolveCitation(id)) invalidCitationIds.push(id);
  }
  // Evidence
  const invalidEvidenceIds: string[] = [];
  for (const id of collectEvidenceIds(a)) if (!ctx.allowedEvidenceIds.has(id)) invalidEvidenceIds.push(id);

  // Claim-level grounding
  const claims: PerClaim[] = (a.claims ?? []).map((c) => {
    const validCites = (c.citation_ids ?? []).filter((id) => ctx.allowedCitationIds.has(id));
    const validEv = (c.evidence_ids ?? []).filter((id) => ctx.allowedEvidenceIds.has(id));
    const citedTokens = expand(validCites.flatMap((id) => tokenize(ctx.citationText.get(id) ?? '', { maxTokens: 4096 })));
    const terms = expand(significant(c.claim));
    let hit = 0;
    for (const t of terms) if (citedTokens.has(t)) hit++;
    const support = terms.size > 0 ? hit / terms.size : 0;
    // Tool-fact support (deterministic tool outputs, e.g. telemetry/alerts).
    let toolHit = 0;
    for (const t of terms) if (ctx.toolFactTokens.has(t)) toolHit++;
    const toolSupport = terms.size > 0 ? toolHit / terms.size : 0;
    const bestSupport = Math.max(support, toolSupport);

    let supported = false;
    let reason: string | null = null;
    if (validCites.length > 0 && support >= threshold) supported = true; // citation-grounded
    else if (validEv.length > 0) supported = true; // evidence-grounded
    else if (toolSupport >= threshold) supported = true; // tool-fact-grounded
    else reason = validCites.length > 0 ? 'INSUFFICIENT_LEXICAL_SUPPORT' : 'NO_GROUNDING';
    return { claim: c.claim, supportScore: Number(bestSupport.toFixed(4)), supported, reason };
  });
  const supportedClaimCount = claims.filter((c) => c.supported).length;
  const averageSupport = claims.length ? Number((claims.reduce((s, c) => s + c.supportScore, 0) / claims.length).toFixed(4)) : null;

  // Policy
  const texts = [a.answer, ...(a.claims ?? []).map((c) => c.claim), ...(a.limitations ?? [])].filter(Boolean);
  const joined = texts.join('\n');
  const policyViolations: { code: string; detail: string }[] = [];
  for (const re of COMMAND) if (re.test(joined)) policyViolations.push({ code: 'OPERATIONAL_COMMAND', detail: String(re) });
  for (const re of ACTION) if (re.test(joined)) policyViolations.push({ code: 'ACTION_EXECUTED_CLAIM', detail: String(re) });
  for (const re of DECISION) if (re.test(joined)) policyViolations.push({ code: 'UNAUTHORIZED_DECISION', detail: String(re) });
  for (const re of SECRET) if (re.test(joined)) policyViolations.push({ code: 'SECRET_LEAK', detail: 'secret-shaped string' });
  // Fabricated IDs
  for (const raw of joined.match(/\bORION-\d+\b/gi) ?? []) if (!ctx.knownSatelliteIds.has(raw.toUpperCase())) policyViolations.push({ code: 'FABRICATED_SATELLITE_ID', detail: raw });
  for (const m of joined.match(/\b(?:investigation|inv)\s*#?\s*(\d+)/gi) ?? []) {
    const n = Number((m.match(/(\d+)/) ?? [])[1]);
    if (Number.isFinite(n) && !ctx.knownInvestigationIds.has(n)) policyViolations.push({ code: 'FABRICATED_INVESTIGATION_ID', detail: String(n) });
  }
  for (const raw of joined.match(/ORION-KB-[A-Z0-9-]+/gi) ?? []) if (!ctx.allowedCitationIds.has(raw)) policyViolations.push({ code: 'FABRICATED_CITATION_IN_TEXT', detail: raw });

  return {
    citationValid: invalidCitationIds.length === 0,
    evidenceValid: invalidEvidenceIds.length === 0,
    groundingValid: claims.every((c) => c.supported),
    policyValid: policyViolations.length === 0,
    invalidCitationIds, invalidEvidenceIds, claims, supportedClaimCount, averageSupport, policyViolations,
  };
}
