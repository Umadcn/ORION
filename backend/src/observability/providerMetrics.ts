/**
 * Phase 9 provider observability + governance (read-only extension of Phase 8).
 * Aggregates provider verification / embedding-space / re-index / comparison
 * audits and derives advisory governance alerts. No credentials, no raw payloads.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { countWhere, distribution, latencyDistribution, rate } from './aggregation.js';
import { fetchRows, num, type RepoContext } from './observabilityRepository.js';
import { llmStatus, embeddingStatus } from '../providers/providerRegistry.js';
import { effectiveActiveSpace, chunkSpaceStats } from '../providers/embeddingSpaceService.js';
import type { GovernanceAlert, ObservabilityTimeRange, DistributionItem, LatencyDistribution } from './types.js';

export interface ProviderObservability {
  llm: { operatingMode: string; providerName: string; model: string | null; lastVerificationStatus: string | null; lastVerifiedAt: string | null; verificationStale: boolean };
  embedding: { operatingMode: string; providerName: string; model: string | null; lastVerificationStatus: string | null; lastVerifiedAt: string | null; verificationStale: boolean };
  verificationCount: number;
  realProviderVerifiedCount: number;
  realEmbeddingVerifiedCount: number;
  unavailableCount: number;
  verificationStatusDistribution: DistributionItem[];
  verificationLatency: LatencyDistribution;
  realProviderExecutionRate: number;
  realEmbeddingExecutionRate: number;
  activeEmbeddingSpace: { spaceKey: string; provider: string; model: string; dimension: number; normalizationPolicy: string; persisted: boolean; isFallback: boolean };
  embeddingSpaceCount: number;
  embeddingSpaceMismatch: boolean;
  latestReindex: { id: number; status: string; processedDocuments: number; totalDocuments: number; targetSpaceKey: string } | null;
  latestComparison: { id: number; status: string; realAvailable: boolean; realAcceptedCount: number; fallbackCount: number; realFailedCount: number } | null;
}

export function buildProviderObservability(ctx: RepoContext): ProviderObservability {
  const now = Date.now();
  const l = llmStatus(now);
  const e = embeddingStatus(now);
  const verifications = fetchRows('provider_verification_executions', ctx);
  const llmExecs = fetchRows('llm_executions', ctx);
  const retrievals = fetchRows('retrieval_executions', ctx);

  const realVerified = countWhere(verifications, (r) => r.status === 'REAL_PROVIDER_VERIFIED');
  const realEmbVerified = countWhere(verifications, (r) => r.status === 'REAL_EMBEDDING_VERIFIED');
  const unavailable = countWhere(verifications, (r) => r.status === 'UNAVAILABLE' || r.status === 'FAILED');

  const active = effectiveActiveSpace();
  const spaces = chunkSpaceStats();

  const reindexRow = db.prepare('SELECT * FROM embedding_reindex_executions ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined;
  const cmpRow = db.prepare('SELECT * FROM provider_comparison_runs ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined;

  const realExecRate = llmExecs.length ? rate(countWhere(llmExecs, (r) => r.execution_mode === 'REAL_PROVIDER'), llmExecs.length) : 0;
  const realEmbRate = retrievals.length ? rate(countWhere(retrievals, (r) => typeof r.embedding_mode === 'string' && r.embedding_mode === 'REAL_EMBEDDING_PROVIDER'), retrievals.length) : 0;

  return {
    llm: { operatingMode: l.operatingMode, providerName: l.providerName, model: l.model, lastVerificationStatus: l.lastVerificationStatus, lastVerifiedAt: l.lastVerifiedAt, verificationStale: l.verificationStale },
    embedding: { operatingMode: e.operatingMode, providerName: e.providerName, model: e.model, lastVerificationStatus: e.lastVerificationStatus, lastVerifiedAt: e.lastVerifiedAt, verificationStale: e.verificationStale },
    verificationCount: verifications.length,
    realProviderVerifiedCount: realVerified,
    realEmbeddingVerifiedCount: realEmbVerified,
    unavailableCount: unavailable,
    verificationStatusDistribution: distribution(verifications.map((r) => (r.status ? String(r.status) : null)), config.observability.maxDistributionItems),
    verificationLatency: latencyDistribution(verifications.map((r) => num(r.latency_ms))),
    realProviderExecutionRate: realExecRate,
    realEmbeddingExecutionRate: realEmbRate,
    activeEmbeddingSpace: { spaceKey: active.spaceKey, provider: active.identity.provider, model: active.identity.model, dimension: active.identity.dimension, normalizationPolicy: active.identity.normalizationPolicy, persisted: active.persisted, isFallback: active.isFallback },
    embeddingSpaceCount: spaces.length,
    embeddingSpaceMismatch: spaces.length > 1,
    latestReindex: reindexRow ? { id: num(reindexRow.id), status: String(reindexRow.status), processedDocuments: num(reindexRow.processed_documents), totalDocuments: num(reindexRow.total_documents), targetSpaceKey: String(reindexRow.target_space_key) } : null,
    latestComparison: cmpRow ? { id: num(cmpRow.id), status: String(cmpRow.status), realAvailable: num(cmpRow.real_available) === 1, realAcceptedCount: num(cmpRow.real_accepted_count), fallbackCount: num(cmpRow.fallback_count), realFailedCount: num(cmpRow.real_failed_count) } : null,
  };
}

/**
 * Advisory provider governance alerts. Guarded so an offline/quiet system raises
 * no noise. Never mutates anything.
 */
export function evaluateProviderGovernance(range: ObservabilityTimeRange, p: ProviderObservability, startSeq: number): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];
  let seq = startSeq;
  const add = (a: Omit<GovernanceAlert, 'alertId' | 'timeRange'>) => alerts.push({ ...a, alertId: `GOV-${++seq}`, timeRange: range });

  for (const kind of ['llm', 'embedding'] as const) {
    const s = p[kind];
    if (s.operatingMode === 'CONFIGURED') {
      add({ severity: 'INFO', category: 'PROVIDER', metric: `${kind}.operatingMode`, observedValue: 0, threshold: 1, comparison: 'LESS_THAN', description: `${kind.toUpperCase()} provider is configured but has not been verified (no successful live check).`, recommendedReviewAction: `Run a Director/Admin ${kind === 'llm' ? 'LLM' : 'embedding'} provider verification.` });
    }
    if (s.verificationStale) {
      add({ severity: 'WARNING', category: 'PROVIDER', metric: `${kind}.verificationStale`, observedValue: 1, threshold: 0, comparison: 'GREATER_THAN', description: `${kind.toUpperCase()} provider verification is stale.`, recommendedReviewAction: `Re-run the ${kind === 'llm' ? 'LLM' : 'embedding'} provider verification.` });
    }
    if (s.operatingMode === 'UNAVAILABLE') {
      add({ severity: 'WARNING', category: 'PROVIDER', metric: `${kind}.operatingMode`, observedValue: 1, threshold: 0, comparison: 'GREATER_THAN', description: `${kind.toUpperCase()} provider is configured but the latest verification failed (auth/network/etc.).`, recommendedReviewAction: 'Inspect provider verification history; the deterministic fallback continues to protect workflows.' });
    }
  }

  if (p.embeddingSpaceMismatch) {
    add({ severity: 'WARNING', category: 'EMBEDDING_SPACE', metric: 'embeddingSpaceCount', observedValue: p.embeddingSpaceCount, threshold: 1, comparison: 'GREATER_THAN', description: 'The corpus contains chunks from more than one embedding space; retrieval fails closed on mismatch.', recommendedReviewAction: 'Run a controlled corpus re-embedding to a single active space.' });
  }
  if (p.latestReindex && p.latestReindex.status === 'FAILED') {
    add({ severity: 'WARNING', category: 'EMBEDDING_SPACE', metric: 'reindex.status', observedValue: 1, threshold: 0, comparison: 'GREATER_THAN', description: 'The most recent corpus re-embedding failed; the previous active space remains in use.', recommendedReviewAction: 'Review the re-index error and retry.' });
  }
  // Real provider AVAILABLE but heavy fallback dependency.
  if (p.llm.operatingMode === 'AVAILABLE' && p.realProviderExecutionRate < 0.5) {
    add({ severity: 'WARNING', category: 'PROVIDER', metric: 'realProviderExecutionRate', observedValue: p.realProviderExecutionRate, threshold: 0.5, comparison: 'LESS_THAN', description: 'A real LLM provider is AVAILABLE but most executions still use the deterministic fallback.', recommendedReviewAction: 'Review provider errors / structured-output validity; verify wiring.' });
  }
  return alerts;
}
