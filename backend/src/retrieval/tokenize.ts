/**
 * Deterministic, ORION-specific tokenization for BM25 lexical retrieval.
 *
 * Design goals:
 *  - Unicode-consistent with Phase 2 normalization (NFC), lowercased.
 *  - Preserve mission identifiers and units that carry meaning:
 *      ORION-3, PAYLOAD_POWER, 28V, BATTERY-2, SAFE_MODE, S-BAND.
 *  - No external NLP dependency, no stemming (which would corrupt identifiers),
 *    and a minimal, mission-safe stopword list that never removes numbers,
 *    units, or identifiers.
 *  - Bounded token count and fully deterministic output.
 *
 * Strategy: normalize to NFC + lowercase, then split on whitespace and a small
 * set of separators, but KEEP internal hyphens and underscores and digits so
 * that identifiers like `orion-3`, `payload_power`, `s-band`, `28v`, and
 * `battery-2` survive as single tokens. Leading/trailing punctuation is trimmed.
 */

// A tiny, mission-safe stopword set. Deliberately excludes anything that could
// be an identifier, unit, or number. Kept minimal so mission meaning is never
// destroyed.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
  'be', 'was', 'were', 'this', 'that', 'it', 'as', 'at', 'by', 'with', 'from',
]);

/** Trim characters that are never part of a mission token when on the edge. */
function trimEdges(tok: string): string {
  return tok.replace(/^[^a-z0-9]+/i, '').replace(/[^a-z0-9]+$/i, '');
}

export interface TokenizeOptions {
  maxTokens?: number;
  keepStopwords?: boolean;
}

/** Tokenize text into deterministic, bounded mission tokens. */
export function tokenize(text: string, opts: TokenizeOptions = {}): string[] {
  const maxTokens = Math.max(1, Math.floor(opts.maxTokens ?? 4096));
  if (!text) return [];
  const normalized = text.normalize('NFC').toLowerCase();

  // Split on whitespace and separators that are NOT internal identifier joiners.
  // We keep '-', '_' and '.' for now, then post-process edges. Commas, slashes,
  // parentheses, colons, semicolons, quotes etc. are separators.
  const rough = normalized.split(/[\s,;:/\\()[\]{}"'`<>|!?]+/);

  const out: string[] = [];
  for (const raw of rough) {
    if (out.length >= maxTokens) break;
    let tok = trimEdges(raw);
    if (!tok) continue;
    // A trailing sentence period on a plain word ("power." -> "power") is
    // already handled by trimEdges. Preserve decimals inside numbers (28.0).
    if (!opts.keepStopwords && STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** Distinct tokens preserving first-seen order (bounded by input tokenization). */
export function uniqueTokens(text: string, opts: TokenizeOptions = {}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(text, opts)) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
