// Pure helpers for rendering ORION AI Assistant answers correctly.
// The direct answer is shown first; raw retrieved sources are collapsed by
// default; conversational / not-found / clarification answers never show a
// sources card. No React, no I/O — unit-tested in isolation.
import type { AssistantResult } from '../api/client';

export type AnswerKind =
  | 'CONVERSATIONAL'   // greeting / thanks / capabilities / out-of-scope
  | 'NOT_FOUND'
  | 'CLARIFICATION'
  | 'INSUFFICIENT'
  | 'REFUSAL'
  | 'STRUCTURED'
  | 'GROUNDED';

/** Classify an assistant result for rendering (deterministic, from the payload). */
export function answerKind(r: Pick<AssistantResult, 'status' | 'diagnostics' | 'citations' | 'answer'>): AnswerKind {
  const intent = r.diagnostics?.intent;
  if (r.status === 'REFUSED' && intent === 'PROHIBITED') return 'REFUSAL';
  if (intent === 'GREETING' || intent === 'THANKS' || intent === 'CAPABILITIES' || intent === 'OUT_OF_SCOPE') return 'CONVERSATIONAL';
  const title = (r.answer?.title ?? '').toLowerCase();
  if (title.startsWith('satellite') && title.includes('not found')) return 'NOT_FOUND';
  if (title.startsWith('clarification')) return 'CLARIFICATION';
  if (r.status === 'INSUFFICIENT_EVIDENCE') return 'INSUFFICIENT';
  if ((r.citations?.length ?? 0) > 0) return 'GROUNDED';
  return 'STRUCTURED';
}

/** Only grounded answers ever surface a (collapsed-by-default) sources panel. */
export function shouldShowSources(r: Pick<AssistantResult, 'status' | 'diagnostics' | 'citations' | 'answer'>): boolean {
  return answerKind(r) === 'GROUNDED' && (r.citations?.length ?? 0) > 0;
}

/** Retrieved sources are collapsed by default (direct answer leads). */
export const SOURCES_DEFAULT_OPEN = false;

/** A ranking/relevance/grounding score is NEVER a confidence score — label it plainly. */
export function scoreLabel(kind: 'relevance' | 'grounding'): string {
  return kind === 'relevance' ? 'relevance' : 'grounding support';
}
