/**
 * Deterministic Agentic-RAG query construction + refinement (Phase 6).
 *
 * Builds bounded, sanitized retrieval queries from authoritative facts + the
 * detected gap. Refinement is deterministic (append gap-driven terms), and
 * duplicate queries are prevented via a seen-hash set. The LLM never supplies
 * an unrestricted retrieval query.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import type { KnowledgeGap } from './types.js';

export interface QueryInputs {
  satelliteId: string;
  subsystem: string | null;
  anomalyTypes: string[];
  rootCauseLabel: string;
  evidenceTerms: string[];
}

function hash(q: string): string {
  return crypto.createHash('sha256').update(q, 'utf8').digest('hex');
}

function sanitize(q: string): string {
  return q.replace(/[^A-Za-z0-9 \-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, config.retrieval.maxQueryChars);
}

/**
 * Build a bounded query. `iteration` deterministically appends refinement terms
 * from the gap so repeated calls diversify. Returns null if the query duplicates
 * one already seen (caller stops refining).
 */
export function buildRetrievalQuery(inputs: QueryInputs, gap: KnowledgeGap, iteration: number, seen: Set<string>): { query: string; hash: string } | null {
  const base = [inputs.satelliteId, inputs.subsystem ?? '', inputs.rootCauseLabel, inputs.anomalyTypes.map((a) => a.replace(/_/g, ' ')).join(' ')];
  const evidenceTerms = inputs.evidenceTerms.filter((w) => w.length >= 4).slice(0, 8);
  const refinement = gap.suggestedTerms.slice(iteration * 3, iteration * 3 + 3); // deterministic slice per iteration
  const q = sanitize([...base, ...evidenceTerms, ...refinement].join(' '));
  const h = hash(q);
  if (seen.has(h) || q.length === 0) return null;
  seen.add(h);
  return { query: q, hash: h };
}

export { hash as hashQuery };
