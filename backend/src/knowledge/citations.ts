/**
 * Stable citation identifiers.
 *
 * A citation ID is deterministic, URL/API-safe, and resolvable back to an exact
 * stored chunk. It is derived from the (sanitized) stable document ID + the
 * chunk index — NEVER from a database auto-increment ID. Given unchanged
 * normalized content and chunking config, the same citation IDs are produced
 * across restarts and re-ingestion.
 *
 *   Format:  ORION-KB-<STABLE_DOCUMENT_ID>-C<0000>
 */

const PREFIX = 'ORION-KB-';
const CHUNK_PAD = 4;

/**
 * Sanitize a caller-supplied stable document ID into a canonical, URL/API-safe
 * form: uppercase A-Z, 0-9, underscore and hyphen only. This canonical value is
 * what gets stored, so citation IDs round-trip exactly.
 */
export function normalizeStableDocumentId(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned;
}

/** Internal stable chunk ID (unique per document+index). */
export function buildStableChunkId(stableDocumentId: string, chunkIndex: number): string {
  return `${stableDocumentId}#${chunkIndex}`;
}

/** Build the public citation ID for a chunk. */
export function buildCitationId(stableDocumentId: string, chunkIndex: number): string {
  return `${PREFIX}${stableDocumentId}-C${String(chunkIndex).padStart(CHUNK_PAD, '0')}`;
}

/** Whether a string is a syntactically valid citation ID. */
export function isValidCitationId(citationId: string): boolean {
  return parseCitationId(citationId) !== null;
}

/**
 * Parse a citation ID back into its parts. Returns null if malformed. The
 * stable document ID may itself contain hyphens, so we anchor on the trailing
 * `-C<digits>` group.
 */
export function parseCitationId(citationId: string): { stableDocumentId: string; chunkIndex: number } | null {
  if (typeof citationId !== 'string' || !citationId.startsWith(PREFIX)) return null;
  const body = citationId.slice(PREFIX.length);
  const m = /^([A-Z0-9_-]+)-C(\d{1,9})$/.exec(body);
  if (!m) return null;
  const stableDocumentId = m[1];
  const chunkIndex = Number(m[2]);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
  return { stableDocumentId, chunkIndex };
}
