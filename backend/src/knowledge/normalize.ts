/**
 * Deterministic text normalization + content hashing for knowledge documents.
 *
 * Guarantees:
 *  - identical logical content -> identical normalized output -> identical hash
 *  - line endings unified to LF, Unicode normalized to NFC
 *  - invalid control characters removed (TAB and NEWLINE preserved)
 *  - paragraph boundaries (blank lines) preserved
 *  - runs of intra-line whitespace collapsed to a single space
 *  - mission-relevant numbers, units, identifiers, and punctuation are NEVER
 *    stripped — normalization only touches whitespace and invalid control chars
 */
import crypto from 'node:crypto';

// Strip C0 control characters EXCEPT TAB (U+0009) and LF (U+000A), plus DEL
// (U+007F). CR (U+000D) is converted to LF beforehand. Built via RegExp so the
// source file contains no literal control bytes.
const INVALID_CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

/** Normalize text deterministically. Pure function — same input -> same output. */
export function normalizeContent(input: string): string {
  if (!input) return '';
  let out = input.normalize('NFC');
  // Unify line endings: CRLF and lone CR -> LF.
  out = out.replace(/\r\n?/g, '\n');
  // Remove invalid control characters (keep TAB + LF).
  out = out.replace(INVALID_CONTROL, '');
  // Normalize each line: collapse runs of spaces/tabs to a single space, trim
  // leading/trailing intra-line whitespace. Paragraph boundaries preserved.
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
  // Collapse 3+ consecutive newlines into exactly two (one blank line = one
  // paragraph boundary). Preserves meaningful paragraph structure.
  out = out.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing blank lines of the whole document.
  out = out.replace(/^\n+/, '').replace(/\n+$/, '');
  return out;
}

/** Stable SHA-256 hex hash of already-normalized content. */
export function contentHash(normalized: string): string {
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Convenience: normalize then hash. */
export function normalizeAndHash(input: string): { normalized: string; hash: string } {
  const normalized = normalizeContent(input);
  return { normalized, hash: contentHash(normalized) };
}

/** Rough deterministic token estimate (~4 chars/token) — no tokenizer dependency. */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
