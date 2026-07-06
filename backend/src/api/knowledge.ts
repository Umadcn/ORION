/**
 * Mission Knowledge Base API (Phase 2).
 *
 * Authenticated for all routes (mounted after the global `authenticate`).
 * Ingestion + operational/audit routes are further restricted by role:
 *   - ingestion (write): Mission Director + System Administrator
 *   - status + retrieval audit: Mission Director + System Administrator
 *   - read/search: any authenticated role (analysts investigate anomalies)
 *
 * There is NO arbitrary filesystem-path or URL ingestion. Documents are plain
 * text only. No secrets are ever returned. All list/batch/query inputs are
 * bounded.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { requireRole } from '../auth/middleware.js';
import type { AuthedRequest } from '../auth/middleware.js';
import {
  describeEmbeddingConfig,
  describeKnowledgeConfig,
  isRealEmbeddingConfigured,
} from '../config.js';
import { ingestBatch, ingestDocument, IngestionValidationError } from '../knowledge/ingestionService.js';
import { retrieve, resolveCitation, RetrievalValidationError, SIMILARITY_DISCLAIMER } from '../knowledge/retrievalService.js';
import { isValidCitationId } from '../knowledge/citations.js';
import { documentRepo, chunkRepo, retrievalAuditRepo, evaluationRepo } from '../knowledge/repository.js';
import { RETRIEVAL_MODES } from '../knowledge/types.js';
import type { KnowledgeDocumentInput, RetrievalMode } from '../knowledge/types.js';
import { compareModes, runEvaluation } from '../retrieval/evaluationService.js';
import { EVALUATION_DATASET_VERSION } from '../retrieval/evaluationDataset.js';

const router = Router();
const opsOnly = requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN');

function numOrUndef(v: unknown): number | undefined {
  return v !== undefined && v !== null && v !== '' ? Number(v) : undefined;
}

// GET /api/knowledge/status — non-secret config + operating mode + corpus size.
router.get('/status', opsOnly, (_req, res) => {
  const docs = documentRepo.list({ limit: 1 });
  res.json({
    embedding: describeEmbeddingConfig(),
    knowledge: describeKnowledgeConfig(),
    operating_mode: isRealEmbeddingConfigured() ? 'REAL_EMBEDDING_PROVIDER' : 'LOCAL_HASH_FALLBACK',
    document_count: docs.total,
    chunk_count: chunkRepo.countAll(),
    retrieval_modes: RETRIEVAL_MODES,
    evaluation_dataset_version: EVALUATION_DATASET_VERSION,
    similarity_disclaimer: SIMILARITY_DISCLAIMER,
  });
});

// POST /api/knowledge/documents — ingest a single plain-text document.
router.post(
  '/documents',
  opsOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const outcome = await ingestDocument(req.body as KnowledgeDocumentInput, req.user?.sub ?? null);
    res.status(outcome.status === 'FAILED' ? 422 : 201).json(outcome);
  }),
);

// POST /api/knowledge/documents/batch — bounded batch ingestion.
router.post(
  '/documents/batch',
  opsOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as { documents?: KnowledgeDocumentInput[] };
    const outcomes = await ingestBatch(body?.documents ?? [], req.user?.sub ?? null);
    res.status(201).json({ count: outcomes.length, results: outcomes });
  }),
);

// GET /api/knowledge/documents — bounded, filtered, paginated listing.
router.get('/documents', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(
    documentRepo.list({
      sourceType: q.source_type,
      subsystem: q.subsystem,
      satelliteId: q.satellite_id,
      anomalyType: q.anomaly_type,
      status: q.status,
      limit: numOrUndef(q.limit),
      offset: numOrUndef(q.offset),
    }),
  );
});

// GET /api/knowledge/documents/:id — a single document (with normalized content).
router.get(
  '/documents/:id',
  asyncHandler((req, res) => {
    const doc = documentRepo.getById(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND', message: 'Document not found' });
    return res.json(doc);
  }),
);

// GET /api/knowledge/documents/:id/chunks — bounded chunk listing (no vectors).
router.get(
  '/documents/:id/chunks',
  asyncHandler((req, res) => {
    const id = Number(req.params.id);
    const doc = documentRepo.getById(id);
    if (!doc) return res.status(404).json({ error: 'NOT_FOUND', message: 'Document not found' });
    const q = req.query as Record<string, string | undefined>;
    const page = chunkRepo.listByDocument(id, numOrUndef(q.limit) ?? 200, numOrUndef(q.offset) ?? 0);
    // Strip the raw embedding vector from the payload; keep provenance metadata.
    const items = page.items.map(({ embedding_json, ...rest }) => rest);
    return res.json({ ...page, items });
  }),
);

// GET /api/knowledge/citations/:citationId — resolve a citation to its chunk.
router.get(
  '/citations/:citationId',
  asyncHandler((req, res) => {
    const citationId = req.params.citationId;
    if (!isValidCitationId(citationId)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Malformed citation ID' });
    }
    const resolved = resolveCitation(citationId);
    if (!resolved) return res.status(404).json({ error: 'NOT_FOUND', message: 'Citation not found' });
    const { embedding_json, ...chunk } = resolved.chunk;
    return res.json({ citation: resolved.citation, chunk });
  }),
);

// POST /api/knowledge/search — bounded retrieval. `mode` selects the pipeline
// (VECTOR default for backward compatibility). Invalid mode -> 400.
router.post(
  '/search',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as { query?: string; top_k?: number; filters?: unknown; mode?: string };
    const result = await retrieve({
      query: body?.query as string,
      topK: numOrUndef(body?.top_k),
      filters: body?.filters as never,
      mode: body?.mode as RetrievalMode | undefined,
      createdBy: req.user?.sub ?? null,
    });
    res.json(result);
  }),
);

// GET /api/knowledge/retrieval-executions — bounded audit list (ops-only).
router.get('/retrieval-executions', opsOnly, (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(
    retrievalAuditRepo.list({
      mode: q.mode,
      status: q.status,
      limit: numOrUndef(q.limit),
      offset: numOrUndef(q.offset),
    }),
  );
});

// GET /api/knowledge/retrieval-executions/:id — single audit record (ops-only).
router.get(
  '/retrieval-executions/:id',
  opsOnly,
  asyncHandler((req, res) => {
    const rec = retrievalAuditRepo.getById(Number(req.params.id));
    if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Retrieval execution not found' });
    return res.json(rec);
  }),
);

// POST /api/knowledge/evaluations/run — run the synthetic benchmark (ops-only).
// body: { mode?: RetrievalMode | 'ALL', k?: number }. Omitted/ALL runs all modes.
// Bounded workload: no arbitrary datasets, no uploads, no code execution.
router.post(
  '/evaluations/run',
  opsOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = req.body as { mode?: string; k?: number };
    const rawMode = (body?.mode ?? 'ALL').toUpperCase();
    const k = numOrUndef(body?.k);
    if (k !== undefined && (!Number.isFinite(k) || k < 1)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'k must be a positive integer' });
    }
    const createdBy = req.user?.sub ?? null;

    if (rawMode === 'ALL') {
      const runs = await compareModes(k, createdBy, true);
      return res.status(201).json({ dataset_version: EVALUATION_DATASET_VERSION, mode: 'ALL', runs });
    }
    if (!RETRIEVAL_MODES.includes(rawMode as RetrievalMode)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: `mode must be ALL or one of: ${RETRIEVAL_MODES.join(', ')}` });
    }
    const run = await runEvaluation({ mode: rawMode as RetrievalMode, k, createdBy, persist: true });
    return res.status(201).json({ dataset_version: EVALUATION_DATASET_VERSION, mode: rawMode, run });
  }),
);

// GET /api/knowledge/evaluations — bounded evaluation-run history (ops-only).
router.get('/evaluations', opsOnly, (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(evaluationRepo.list({ mode: q.mode, limit: numOrUndef(q.limit), offset: numOrUndef(q.offset) }));
});

// GET /api/knowledge/evaluations/:id — single evaluation run (ops-only).
router.get(
  '/evaluations/:id',
  opsOnly,
  asyncHandler((req, res) => {
    const rec = evaluationRepo.getById(Number(req.params.id));
    if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Evaluation run not found' });
    return res.json(rec);
  }),
);

export default router;
