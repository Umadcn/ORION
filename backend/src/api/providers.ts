/**
 * Provider management + live verification + re-embedding + evaluation API
 * (Phase 9). ALL routes Director/Admin only. No API keys in requests or
 * responses; no arbitrary endpoint/model/provider/prompt overrides; fixed
 * internal verification requests; bounded workloads; parameterized SQL.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import type { AuthedRequest } from '../auth/middleware.js';
import { requireRole } from '../auth/middleware.js';
import { describeProvidersConfig } from '../config.js';
import type { Role } from '../auth/users.js';
import { llmCapabilities, embeddingCapabilities } from '../providers/providerCapabilities.js';
import { validateLlmProvider, validateEmbeddingProvider } from '../providers/providerValidation.js';
import { llmStatus, embeddingStatus } from '../providers/providerRegistry.js';
import { providerHealthService } from '../providers/providerHealthService.js';
import { listVerifications } from '../providers/providerRepository.js';
import { effectiveActiveSpace, listSpaces, chunkSpaceStats, reindexCorpus } from '../providers/embeddingSpaceService.js';
import { getReindex } from '../providers/providerRepository.js';
import { runComparison, ProviderComparisonCooldownError } from '../evaluation/providerComparisonService.js';
import { getComparisonRun, listComparisonRuns } from '../providers/providerRepository.js';

const router = Router();
router.use(requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'));

const numOrUndef = (v: unknown): number | undefined => (v !== undefined && v !== null && v !== '' ? Number(v) : undefined);
const userId = (req: AuthedRequest) => req.user!.sub;
const role = (req: AuthedRequest) => req.user!.role as Role;

// --- Status + capabilities (read-only; NO credentials) ---
router.get('/status', (_req, res) => {
  const now = Date.now();
  res.json({ read_only: true, llm: llmStatus(now), embedding: embeddingStatus(now), validation: { llm: validateLlmProvider(), embedding: validateEmbeddingProvider() }, config: describeProvidersConfig() });
});
router.get('/capabilities', (_req, res) => {
  res.json({ llm: llmCapabilities(), embedding: embeddingCapabilities() });
});

// --- Live verification (fixed internal request; fallback can never satisfy) ---
router.post('/llm/verify', asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await providerHealthService.verifyLlm(userId(req)));
}));
router.post('/embeddings/verify', asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await providerHealthService.verifyEmbedding(userId(req)));
}));
router.get('/verifications', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(listVerifications({ kind: q.kind, status: q.status, limit: numOrUndef(q.limit), offset: numOrUndef(q.offset) }));
});

// --- Embedding spaces + re-index ---
router.get('/embedding-spaces', (_req, res) => {
  res.json({ spaces: listSpaces(), chunkSpaceStats: chunkSpaceStats() });
});
router.get('/embedding-spaces/active', (_req, res) => {
  res.json(effectiveActiveSpace());
});
router.post('/embeddings/reindex', asyncHandler(async (req: AuthedRequest, res) => {
  res.json(await reindexCorpus({ userId: userId(req) }));
}));
router.get('/embeddings/reindex/:id', asyncHandler((req, res) => {
  const rec = getReindex(Number(req.params.id));
  if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Reindex execution not found' });
  return res.json(rec);
}));

// --- Real-vs-fallback evaluation ---
router.post('/evaluations/compare', asyncHandler(async (req: AuthedRequest, res) => {
  try {
    const result = await runComparison({ userId: userId(req), role: role(req), maxScenarios: numOrUndef((req.body ?? {}).maxScenarios) });
    return res.json(result);
  } catch (err) {
    if (err instanceof ProviderComparisonCooldownError) return res.status(429).json({ error: 'COOLDOWN', message: err.message });
    throw err;
  }
}));
router.get('/evaluations', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(listComparisonRuns(numOrUndef(q.limit), numOrUndef(q.offset)));
});
router.get('/evaluations/:id', asyncHandler((req, res) => {
  const rec = getComparisonRun(Number(req.params.id));
  if (!rec) return res.status(404).json({ error: 'NOT_FOUND', message: 'Comparison run not found' });
  return res.json(rec);
}));

export default router;
