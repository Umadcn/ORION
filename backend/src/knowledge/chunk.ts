/**
 * Deterministic, paragraph-aware chunking.
 *
 * The algorithm walks the normalized text in bounded character windows and
 * prefers to break at paragraph boundaries, then line breaks, then word
 * boundaries, falling back to a hard cut only when necessary. It is:
 *   - deterministic (same content + config -> same chunks + offsets + IDs)
 *   - bounded (chunk size + overlap are validated; forward progress guaranteed)
 *   - loop-safe (position strictly increases every iteration)
 *
 * Chunk IDs and citation IDs are stable across restarts and identical
 * re-ingestion because they depend only on stable_document_id + chunk index.
 */
import { buildCitationId, buildStableChunkId } from './citations.js';
import { contentHash, estimateTokenCount } from './normalize.js';
import type { ChunkingConfig, ProducedChunk } from './types.js';

/** Hard safety bounds independent of configuration. */
export const CHUNK_HARD_MIN = 32;
export const CHUNK_HARD_MAX = 20000;
export const MAX_CHUNKS_PER_DOCUMENT = 5000;

/** Validate + clamp a chunking config into a safe, deterministic shape. */
export function resolveChunkingConfig(cfg: Partial<ChunkingConfig>): ChunkingConfig {
  let chunkSize = Math.floor(cfg.chunkSize ?? 1200);
  if (!Number.isFinite(chunkSize)) chunkSize = 1200;
  chunkSize = Math.max(CHUNK_HARD_MIN, Math.min(CHUNK_HARD_MAX, chunkSize));

  let chunkOverlap = Math.floor(cfg.chunkOverlap ?? 150);
  if (!Number.isFinite(chunkOverlap) || chunkOverlap < 0) chunkOverlap = 0;
  // Overlap must be strictly less than chunk size to guarantee forward progress.
  chunkOverlap = Math.min(chunkOverlap, Math.floor(chunkSize / 2));

  let minChunkSize = Math.floor(cfg.minChunkSize ?? Math.min(200, Math.floor(chunkSize / 4)));
  if (!Number.isFinite(minChunkSize) || minChunkSize < 1) minChunkSize = 1;
  minChunkSize = Math.min(minChunkSize, chunkSize);

  return { chunkSize, chunkOverlap, minChunkSize };
}

/**
 * Produce chunks for a normalized document. `stableDocumentId` must already be
 * canonical (see normalizeStableDocumentId).
 */
export function chunkDocument(
  stableDocumentId: string,
  normalized: string,
  cfgIn: Partial<ChunkingConfig>,
): ProducedChunk[] {
  const cfg = resolveChunkingConfig(cfgIn);
  const text = normalized;
  const n = text.length;
  const chunks: ProducedChunk[] = [];
  if (n === 0) return chunks;

  let pos = 0;
  let index = 0;

  while (pos < n && chunks.length < MAX_CHUNKS_PER_DOCUMENT) {
    const windowEnd = Math.min(pos + cfg.chunkSize, n);
    let breakPoint = windowEnd;

    if (windowEnd < n) {
      breakPoint = findBreakPoint(text, pos, windowEnd, cfg.minChunkSize);
    }

    // Defensive: guarantee the break is beyond pos.
    if (breakPoint <= pos) breakPoint = Math.min(pos + cfg.chunkSize, n);

    const content = text.slice(pos, breakPoint).trim();
    // Skip degenerate empty slices (e.g. runs of whitespace) but keep advancing.
    if (content.length > 0) {
      const startOffset = pos;
      const endOffset = breakPoint;
      chunks.push({
        chunkIndex: index,
        stableChunkId: buildStableChunkId(stableDocumentId, index),
        citationId: buildCitationId(stableDocumentId, index),
        content,
        contentHash: contentHash(content),
        startOffset,
        endOffset,
        tokenCountEstimate: estimateTokenCount(content),
      });
      index++;
    }

    if (breakPoint >= n) break;

    // Advance with overlap, but ALWAYS make strictly positive progress.
    let nextPos = breakPoint - cfg.chunkOverlap;
    if (nextPos <= pos) nextPos = breakPoint; // drop overlap rather than stall
    pos = nextPos;
  }

  // Minimum-size handling: fold a too-small trailing chunk into its predecessor
  // (never leaving zero chunks). This keeps chunk boundaries meaningful while
  // remaining fully deterministic.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    if (last.content.length < cfg.minChunkSize) {
      const prev = chunks[chunks.length - 2];
      const mergedContent = text.slice(prev.startOffset, last.endOffset).trim();
      chunks.pop();
      chunks[chunks.length - 1] = {
        ...prev,
        content: mergedContent,
        contentHash: contentHash(mergedContent),
        endOffset: last.endOffset,
        tokenCountEstimate: estimateTokenCount(mergedContent),
      };
    }
  }

  return chunks;
}

/**
 * Choose a break point in (pos, windowEnd], preferring paragraph boundaries,
 * then line breaks, then word boundaries. Only accepts a boundary that leaves
 * at least `minChunkSize` characters in the chunk; otherwise hard-cuts at
 * windowEnd.
 */
function findBreakPoint(text: string, pos: number, windowEnd: number, minChunkSize: number): number {
  const minEnd = pos + minChunkSize;
  const slice = text.slice(pos, windowEnd);

  // Paragraph boundary: last blank line within the window.
  const para = slice.lastIndexOf('\n\n');
  if (para >= 0) {
    const abs = pos + para + 2; // break AFTER the blank line
    if (abs >= minEnd) return abs;
  }
  // Line boundary.
  const nl = slice.lastIndexOf('\n');
  if (nl >= 0) {
    const abs = pos + nl + 1;
    if (abs >= minEnd) return abs;
  }
  // Word boundary.
  const sp = slice.lastIndexOf(' ');
  if (sp >= 0) {
    const abs = pos + sp + 1;
    if (abs >= minEnd) return abs;
  }
  // No acceptable boundary -> hard cut.
  return windowEnd;
}
