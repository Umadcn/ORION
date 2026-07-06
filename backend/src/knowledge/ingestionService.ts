/**
 * Safe, deterministic knowledge ingestion.
 *
 * Accepts bounded plain-text mission documents only. There is NO filesystem
 * path ingestion, NO URL fetching, NO remote downloads, and NO executable
 * document processing. `sourceUri` is stored as an opaque provenance label and
 * is never dereferenced. Ingestion is idempotent for identical content and
 * performs a safe, transactional replace during controlled re-ingestion.
 */
import { config } from '../config.js';
import { chunkDocument } from './chunk.js';
import { normalizeStableDocumentId } from './citations.js';
import { normalizeAndHash } from './normalize.js';
import { resolveEmbeddingProvider } from '../embeddings/index.js';
import { EmbeddingError, type EmbeddingProvider } from '../embeddings/provider.js';
import { documentRepo } from './repository.js';
import { vectorStore } from './vectorStore.js';
import {
  KNOWLEDGE_CLASSIFICATIONS,
  KNOWLEDGE_SOURCE_TYPES,
  type IngestionOutcome,
  type KnowledgeChunkMetadata,
  type KnowledgeClassification,
  type KnowledgeDocumentInput,
  type KnowledgeSourceType,
} from './types.js';

/** Thrown for invalid ingestion input (maps to HTTP 400). */
export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}

const MAX_TITLE = 300;
const MAX_META_FIELD = 200;
const MAX_STABLE_ID = 200;

/** Validate + coerce a single ingestion input. Throws IngestionValidationError. */
function validateInput(raw: KnowledgeDocumentInput): Required<
  Pick<KnowledgeDocumentInput, 'stableDocumentId' | 'title' | 'sourceType' | 'content'>
> & KnowledgeDocumentInput {
  if (!raw || typeof raw !== 'object') throw new IngestionValidationError('Document input must be an object');

  if (typeof raw.content !== 'string' || raw.content.trim().length === 0) {
    throw new IngestionValidationError('content is required and must be non-empty text');
  }
  if (raw.content.length > config.knowledge.maxDocumentChars) {
    throw new IngestionValidationError(
      `content exceeds max ${config.knowledge.maxDocumentChars} characters`,
    );
  }
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0 || raw.title.length > MAX_TITLE) {
    throw new IngestionValidationError('title is required and must be 1-300 characters');
  }
  const stableRaw = typeof raw.stableDocumentId === 'string' ? raw.stableDocumentId : '';
  if (!stableRaw || stableRaw.length > MAX_STABLE_ID) {
    throw new IngestionValidationError('stableDocumentId is required and must be 1-200 characters');
  }
  const canonicalId = normalizeStableDocumentId(stableRaw);
  if (!canonicalId) {
    throw new IngestionValidationError('stableDocumentId must contain at least one alphanumeric character');
  }
  if (!KNOWLEDGE_SOURCE_TYPES.includes(raw.sourceType as KnowledgeSourceType)) {
    throw new IngestionValidationError(`sourceType must be one of: ${KNOWLEDGE_SOURCE_TYPES.join(', ')}`);
  }
  if (raw.classification !== undefined && !KNOWLEDGE_CLASSIFICATIONS.includes(raw.classification as KnowledgeClassification)) {
    throw new IngestionValidationError(`classification must be one of: ${KNOWLEDGE_CLASSIFICATIONS.join(', ')}`);
  }
  for (const [k, v] of Object.entries({
    subsystem: raw.subsystem, satelliteId: raw.satelliteId, anomalyType: raw.anomalyType,
    documentVersion: raw.documentVersion, sourceUri: raw.sourceUri, provenanceOrigin: raw.provenanceOrigin,
  })) {
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > MAX_META_FIELD)) {
      throw new IngestionValidationError(`${k} must be a string up to ${MAX_META_FIELD} characters`);
    }
  }

  return { ...raw, stableDocumentId: canonicalId, title: raw.title.trim(), sourceType: raw.sourceType, content: raw.content };
}

async function embedInBatches(provider: EmbeddingProvider, texts: string[]): Promise<number[][]> {
  const batchSize = Math.max(1, config.embedding.maxBatchSize);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const vecs = await provider.embedBatch(slice);
    out.push(...vecs);
  }
  return out;
}

/** Ingest a single document. Never throws for processing errors — returns a
 *  FAILED outcome instead (validation errors DO throw for a 400 response). */
export async function ingestDocument(rawInput: KnowledgeDocumentInput, createdBy: string | null): Promise<IngestionOutcome> {
  const input = validateInput(rawInput);
  const { normalized, hash } = normalizeAndHash(input.content);
  const provenanceOrigin = input.provenanceOrigin || 'API_INGESTION';
  const classification: KnowledgeClassification = (input.classification as KnowledgeClassification) || 'UNCLASSIFIED';
  const documentVersion = input.documentVersion || 'v1';

  const existing = documentRepo.findByStableId(input.stableDocumentId);

  // Idempotent no-op: same stable id + identical content already READY.
  if (existing && existing.content_hash === hash && existing.status === 'READY') {
    const chunks = chunkDocument(input.stableDocumentId, normalized, {
      chunkSize: config.knowledge.chunkSize,
      chunkOverlap: config.knowledge.chunkOverlap,
      minChunkSize: Math.min(200, Math.floor(config.knowledge.chunkSize / 4)),
    });
    return {
      stableDocumentId: input.stableDocumentId,
      documentId: existing.id,
      status: 'READY',
      chunkCount: existing.chunk_count,
      contentHash: hash,
      deduplicated: true,
      reIngested: false,
      citationIds: chunks.map((c) => c.citationId),
    };
  }

  // Create or update the document row, then process.
  let documentId: number;
  let reIngested = false;
  if (existing) {
    reIngested = true;
    documentId = existing.id;
    documentRepo.updateContent(documentId, {
      title: input.title, source_type: input.sourceType, classification,
      subsystem: input.subsystem ?? null, satellite_id: input.satelliteId ?? null,
      anomaly_type: input.anomalyType ?? null, document_version: documentVersion,
      source_uri: input.sourceUri ?? null, provenance_origin: provenanceOrigin,
      content_hash: hash, normalized_content: normalized, char_count: normalized.length,
    });
    documentRepo.updateStatus(documentId, 'PROCESSING');
  } else {
    const doc = documentRepo.create({
      stable_document_id: input.stableDocumentId, title: input.title, source_type: input.sourceType,
      classification, subsystem: input.subsystem ?? null, satellite_id: input.satelliteId ?? null,
      anomaly_type: input.anomalyType ?? null, document_version: documentVersion,
      source_uri: input.sourceUri ?? null, provenance_origin: provenanceOrigin, content_hash: hash,
      normalized_content: normalized, char_count: normalized.length, status: 'PROCESSING', created_by: createdBy,
    });
    documentId = doc.id;
  }

  try {
    const chunks = chunkDocument(input.stableDocumentId, normalized, {
      chunkSize: config.knowledge.chunkSize,
      chunkOverlap: config.knowledge.chunkOverlap,
      minChunkSize: Math.min(200, Math.floor(config.knowledge.chunkSize / 4)),
    });
    if (chunks.length === 0) {
      documentRepo.updateStatus(documentId, 'FAILED', 'NO_CHUNKS_PRODUCED');
      return { stableDocumentId: input.stableDocumentId, status: 'FAILED', reason: 'NO_CHUNKS_PRODUCED' };
    }

    const { provider } = resolveEmbeddingProvider();
    const vectors = await embedInBatches(provider, chunks.map((c) => c.content));

    const metadata: KnowledgeChunkMetadata = {
      documentId, stableDocumentId: input.stableDocumentId, title: input.title,
      sourceType: input.sourceType, classification, subsystem: input.subsystem ?? null,
      satelliteId: input.satelliteId ?? null, anomalyType: input.anomalyType ?? null, documentVersion,
    };

    vectorStore.upsertChunks(documentId, chunks, vectors, {
      provider: provider.name, model: provider.model, mode: provider.mode,
      version: provider.version, dimension: provider.dimension(),
    }, JSON.stringify(metadata));

    documentRepo.setChunkCount(documentId, chunks.length);
    documentRepo.updateStatus(documentId, 'READY');

    return {
      stableDocumentId: input.stableDocumentId,
      documentId,
      status: 'READY',
      chunkCount: chunks.length,
      contentHash: hash,
      deduplicated: false,
      reIngested,
      citationIds: chunks.map((c) => c.citationId),
    };
  } catch (err) {
    const reason = err instanceof EmbeddingError ? `EMBEDDING_FAILED:${err.code}` : 'PROCESSING_ERROR';
    documentRepo.updateStatus(documentId, 'FAILED', reason);
    return { stableDocumentId: input.stableDocumentId, status: 'FAILED', reason };
  }
}

/** Ingest a bounded batch. Per-document failures are isolated. */
export async function ingestBatch(inputs: KnowledgeDocumentInput[], createdBy: string | null): Promise<IngestionOutcome[]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new IngestionValidationError('documents must be a non-empty array');
  }
  if (inputs.length > config.knowledge.maxBatchDocuments) {
    throw new IngestionValidationError(`batch exceeds max ${config.knowledge.maxBatchDocuments} documents`);
  }
  const outcomes: IngestionOutcome[] = [];
  for (const input of inputs) {
    try {
      outcomes.push(await ingestDocument(input, createdBy));
    } catch (err) {
      if (err instanceof IngestionValidationError) {
        outcomes.push({
          stableDocumentId: typeof input?.stableDocumentId === 'string' ? input.stableDocumentId : '(invalid)',
          status: 'FAILED',
          reason: `VALIDATION:${err.message}`,
        });
      } else {
        throw err;
      }
    }
  }
  return outcomes;
}
