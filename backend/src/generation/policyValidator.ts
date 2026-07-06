/**
 * Deterministic generated-output policy validation (Phase 4). Bounded + explainable.
 *
 * Rejects outputs that: issue operational satellite-control commands, claim
 * actions were executed, assert approve/reject/resolve decisions, contradict the
 * authoritative deterministic RCA, reference fabricated satellite/investigation/
 * citation IDs, exceed array bounds, or leak secret-shaped strings.
 */
import { config } from '../config.js';
import type { GeneratedBriefing, GroundedGenerationContext, PolicyValidationResult, PolicyViolation } from './types.js';

const COMMAND_PATTERNS: RegExp[] = [
  /\b(uplink|transmit|send)\s+(a\s+)?command/i,
  /\bexecute\s*:/i,
  /\bcommand\s*:/i,
  /\bfire\s+thrusters?\b/i,
  /\b(power|shut)\s*(off|down)\s+the\s+(satellite|spacecraft|payload)\b/i,
];
const ACTION_EXECUTED_PATTERNS: RegExp[] = [
  /\b(has|have|was|were)\s+(been\s+)?(executed|commanded|uplinked|transmitted|activated|deactivated)\b/i,
  /\b(i|we)\s+(have\s+)?(executed|commanded|sent|uplinked|transmitted)\b/i,
  /\baction[s]?\s+(taken|executed|performed|completed)\b/i,
];
const DECISION_PATTERNS: RegExp[] = [
  /\b(approve|reject|resolve|approved|rejected|resolved)\b[^.]*\binvestigation\b/i,
  /\bdecision\s*:\s*(approve|reject|resolve)/i,
];
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{8,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(xoxb|ghp|pk)-[A-Za-z0-9_-]{8,}\b/,
];

/** All human-readable text fields in the briefing (for scanning). */
function allText(b: GeneratedBriefing): string[] {
  const out: string[] = [b.title ?? '', b.summary ?? ''];
  for (const s of b.situation ?? []) out.push(s.claim ?? '');
  out.push(b.root_cause?.explanation ?? '');
  for (const e of b.evidence_summary ?? []) out.push(e.claim ?? '');
  for (const r of b.recommended_review_items ?? []) out.push(r.item ?? '');
  for (const l of b.limitations ?? []) out.push(l);
  return out.filter(Boolean);
}

function arrayBounds(b: GeneratedBriefing): PolicyViolation[] {
  const g = config.generation;
  const v: PolicyViolation[] = [];
  const check = (n: number, max: number, name: string) => {
    if (n > max) v.push({ code: 'ARRAY_BOUND_EXCEEDED', detail: `${name} has ${n} items (max ${max})` });
  };
  check((b.situation ?? []).length, g.maxClaims, 'situation');
  check((b.evidence_summary ?? []).length, g.maxClaims, 'evidence_summary');
  check((b.recommended_review_items ?? []).length, g.maxClaims, 'recommended_review_items');
  check((b.limitations ?? []).length, g.maxClaims, 'limitations');
  return v;
}

export function validatePolicy(b: GeneratedBriefing, ctx: GroundedGenerationContext, knownSatelliteIds: Set<string>): PolicyValidationResult {
  const violations: PolicyViolation[] = [];
  const texts = allText(b);
  const joined = texts.join('\n');

  for (const re of COMMAND_PATTERNS) if (re.test(joined)) violations.push({ code: 'OPERATIONAL_COMMAND', detail: `matched ${re}` });
  for (const re of ACTION_EXECUTED_PATTERNS) if (re.test(joined)) violations.push({ code: 'ACTION_EXECUTED_CLAIM', detail: `matched ${re}` });
  for (const re of DECISION_PATTERNS) if (re.test(joined)) violations.push({ code: 'UNAUTHORIZED_DECISION', detail: `matched ${re}` });
  for (const re of SECRET_PATTERNS) if (re.test(joined)) violations.push({ code: 'SECRET_LEAK', detail: 'secret-shaped string present' });

  // Root cause must not contradict the authoritative deterministic RCA.
  if ((b.root_cause?.authoritative_root_cause ?? '') !== ctx.systemFacts.authoritativeRootCause) {
    violations.push({ code: 'ROOT_CAUSE_CONTRADICTION', detail: 'authoritative_root_cause does not match deterministic RCA' });
  }

  // Fabricated satellite IDs (ORION-<n> not in the known satellite set).
  const satMatches = joined.match(/\bORION-\d+\b/gi) ?? [];
  for (const raw of satMatches) {
    const id = raw.toUpperCase();
    if (!knownSatelliteIds.has(id)) violations.push({ code: 'FABRICATED_SATELLITE_ID', detail: id });
  }

  // Fabricated investigation IDs asserted in prose (different numeric id).
  const invMatches = joined.match(/\binvestigation\s+#?(\d+)/gi) ?? [];
  for (const m of invMatches) {
    const n = Number((m.match(/(\d+)/) ?? [])[1]);
    if (Number.isFinite(n) && n !== ctx.investigationId) {
      violations.push({ code: 'FABRICATED_INVESTIGATION_ID', detail: String(n) });
    }
  }

  // Citation-like tokens embedded in prose must be in the allowed set.
  const allowed = new Set(ctx.allowedCitationIds);
  const citeMatches = joined.match(/ORION-KB-[A-Z0-9-]+/gi) ?? [];
  for (const raw of citeMatches) {
    if (!allowed.has(raw)) violations.push({ code: 'FABRICATED_CITATION_IN_TEXT', detail: raw });
  }

  violations.push(...arrayBounds(b));

  return { valid: violations.length === 0, violations };
}
