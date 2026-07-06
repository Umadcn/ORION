/**
 * Deterministic answer↔question alignment validator (Phase 10 correctness repair).
 *
 * Confirms the final answer actually addresses the resolved intent before it is
 * returned. Intentionally CONSERVATIVE: it only rejects clear mismatches (so it
 * never degrades a correct answer). A rejected answer is replaced upstream by a
 * safe INSUFFICIENT_EVIDENCE response.
 */
import type { AssistantAnswer, AssistantIntent } from './types.js';

export interface AlignmentResult {
  aligned: boolean;
  reason: string;
}

const ABSTENTION_TITLES = /^(insufficient evidence|outside my scope|not authorized|request not permitted|satellite .* not found)/i;

function isAbstention(a: AssistantAnswer): boolean {
  return ABSTENTION_TITLES.test(a.title ?? '');
}

export function validateAlignment(intent: AssistantIntent, answer: AssistantAnswer, opts: { hasCitations: boolean }): AlignmentResult {
  const summary = String(answer?.summary ?? '').trim();
  if (!summary) return { aligned: false, reason: 'EMPTY_ANSWER' };

  // An explicit abstention/refusal/not-found always aligns (it is a valid, honest answer).
  if (isAbstention(answer)) return { aligned: true, reason: 'ABSTENTION' };

  switch (intent) {
    case 'MISSION_KNOWLEDGE_SEARCH':
      // A non-abstaining mission-knowledge answer MUST be supported by citations.
      if (!opts.hasCitations) return { aligned: false, reason: 'KNOWLEDGE_WITHOUT_CITATION' };
      return { aligned: true, reason: 'OK' };
    case 'GREETING':
    case 'THANKS':
    case 'CAPABILITIES':
    case 'OUT_OF_SCOPE':
      // Conversational answers must NOT carry mission citations.
      if (opts.hasCitations) return { aligned: false, reason: 'CONVERSATIONAL_WITH_CITATION' };
      return { aligned: true, reason: 'OK' };
    default:
      return { aligned: true, reason: 'OK' };
  }
}
