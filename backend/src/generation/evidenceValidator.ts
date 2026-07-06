/**
 * Reusable deterministic-evidence validation (Phase 4). Deterministic + bounded.
 *
 * Every generated evidence ID must exist, belong to the requested investigation,
 * and have been included in the generation context. Cross-investigation or
 * fabricated evidence IDs fail.
 */
import { getEvidence } from '../services/investigationService.js';
import type { EvidenceValidationResult, GeneratedBriefing, GroundedGenerationContext } from './types.js';

export function collectEvidenceIds(b: GeneratedBriefing): string[] {
  const ids: string[] = [];
  for (const e of b.evidence_summary ?? []) ids.push(...(e.evidence_ids ?? []));
  return ids;
}

export function validateEvidence(
  b: GeneratedBriefing,
  ctx: GroundedGenerationContext,
  investigationId: number,
): EvidenceValidationResult {
  const inContext = new Set(ctx.allowedEvidenceIds);
  // Ground truth: evidence rows that actually belong to this investigation.
  const ownedIds = new Set(getEvidence(investigationId).map((e) => String(e.id)));

  const invalid = new Set<string>();
  const reasons: string[] = [];
  for (const id of collectEvidenceIds(b)) {
    if (!ownedIds.has(id)) {
      invalid.add(id);
      reasons.push(`evidence ID does not belong to investigation ${investigationId}: ${id}`);
      continue;
    }
    if (!inContext.has(id)) {
      invalid.add(id);
      reasons.push(`evidence ID not included in generation context: ${id}`);
    }
  }
  return { valid: invalid.size === 0, invalidEvidenceIds: [...invalid], reasons };
}
