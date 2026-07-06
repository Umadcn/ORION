/**
 * Provider status registry (Phase 9). Derives the operating mode for each
 * provider kind from (a) safe configuration and (b) the latest live
 * verification. A configured provider is NEVER automatically AVAILABLE —
 * AVAILABLE requires a fresh successful verification. Never exposes credentials.
 */
import { config, isLlmProviderConfiguredSafely, isEmbeddingProviderConfiguredSafely, isTrustedEndpoint } from '../config.js';
import { latestVerification } from './providerRepository.js';
import type { ProviderKind, ProviderOperatingMode, ProviderStatusSummary, VerificationStatus } from './types.js';

const VERIFIED_STATUSES = new Set<VerificationStatus>(['REAL_PROVIDER_VERIFIED', 'REAL_EMBEDDING_VERIFIED']);

function operatingMode(kind: ProviderKind, configuredSafely: boolean, lastStatus: VerificationStatus | null, stale: boolean): ProviderOperatingMode {
  if (!configuredSafely) return 'OFFLINE';
  if (lastStatus === null) return 'CONFIGURED';
  if (VERIFIED_STATUSES.has(lastStatus)) return stale ? 'CONFIGURED' : 'AVAILABLE';
  if (lastStatus === 'DEGRADED') return 'DEGRADED';
  if (lastStatus === 'UNAVAILABLE' || lastStatus === 'FAILED') return 'UNAVAILABLE';
  return 'CONFIGURED'; // COOLDOWN / NOT_CONFIGURED etc. → no fresh success
}

function summary(kind: ProviderKind, providerName: string, model: string | null, configuredSafely: boolean, allowlisted: boolean, endpointTrusted: boolean, nowMs: number): ProviderStatusSummary {
  const last = latestVerification(kind);
  const lastStatus = (last?.status as VerificationStatus | undefined) ?? null;
  const lastVerifiedAt = last ? String(last.created_at) : null;
  const ageMs = lastVerifiedAt ? nowMs - new Date(lastVerifiedAt).getTime() : null;
  const stale = ageMs === null ? true : ageMs > config.providers.verificationStaleMs;
  return {
    kind,
    providerName,
    model,
    operatingMode: operatingMode(kind, configuredSafely, lastStatus, stale),
    configuredSafely,
    allowlisted,
    endpointTrusted,
    lastVerificationStatus: lastStatus,
    lastVerifiedAt,
    verificationStale: lastStatus !== null && VERIFIED_STATUSES.has(lastStatus) ? stale : false,
  };
}

export function llmStatus(nowMs: number): ProviderStatusSummary {
  const safe = isLlmProviderConfiguredSafely();
  const trusted = config.llm.endpoint ? isTrustedEndpoint(config.llm.endpoint).trusted : false;
  return summary('LLM', config.llm.provider, config.llm.model || null, safe.ok, config.providers.llmAllowlist.includes(config.llm.provider), trusted, nowMs);
}

export function embeddingStatus(nowMs: number): ProviderStatusSummary {
  const safe = isEmbeddingProviderConfiguredSafely();
  const trusted = config.embedding.endpoint ? isTrustedEndpoint(config.embedding.endpoint).trusted : false;
  return summary('EMBEDDING', config.embedding.provider, config.embedding.model || null, safe.ok, config.providers.embeddingAllowlist.includes(config.embedding.provider), trusted, nowMs);
}
