/**
 * Provider status + verification presentation helpers (Phase 9). Read-only.
 *
 * NEVER labels OFFLINE / CONFIGURED / deterministic fallback as real AI, and
 * NEVER labels ranking/grounding scores as confidence. Mirrors the backend
 * /api/providers/* response shapes.
 */
export type ProviderOperatingMode = 'OFFLINE' | 'CONFIGURED' | 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';

export interface ProviderStatusSummary {
  kind: 'LLM' | 'EMBEDDING';
  providerName: string;
  model: string | null;
  operatingMode: ProviderOperatingMode;
  configuredSafely: boolean;
  allowlisted: boolean;
  endpointTrusted: boolean;
  lastVerificationStatus: string | null;
  lastVerifiedAt: string | null;
  verificationStale: boolean;
}

export interface ProvidersStatus {
  read_only: boolean;
  llm: ProviderStatusSummary;
  embedding: ProviderStatusSummary;
  config: Record<string, unknown>;
}

export interface VerificationResult {
  verificationId: number | null;
  providerKind: 'LLM' | 'EMBEDDING';
  providerName: string;
  model: string | null;
  status: string;
  liveProviderReached: boolean;
  latencyMs: number;
  structuredOutputValid: boolean | null;
  embeddingDimensionValid: boolean | null;
  normalizedErrorCode: string | null;
  sanitizedErrorMessage: string | null;
  createdAt: string;
}

export interface ActiveSpaceInfo {
  spaceKey: string;
  identity: { provider: string; model: string; version: string; dimension: number; normalizationPolicy: string };
  persisted: boolean;
  isFallback: boolean;
}

export interface ReindexResult {
  reindexId: number;
  status: string;
  sourceSpaceKey: string | null;
  targetSpaceKey: string;
  totalDocuments: number;
  processedDocuments: number;
  totalChunks: number;
  processedChunks: number;
  failedDocuments: number;
  sanitizedErrorMessage: string | null;
}

export interface ComparisonRunResult {
  comparisonRunId: number;
  datasetVersion: string;
  scenarioCount: number;
  realAvailable: boolean;
  realAcceptedCount: number;
  realFailedCount: number;
  fallbackCount: number;
  realGroundingValidRate: number | null;
  fallbackGroundingValidRate: number | null;
  realAvgLatencyMs: number | null;
  fallbackAvgLatencyMs: number | null;
  status: string;
}

/** Operating-mode label. OFFLINE/CONFIGURED are NEVER labeled as real AI. */
export function operatingModeLabel(mode: ProviderOperatingMode): { label: string; tone: 'slate' | 'cyan' | 'green' | 'orange' | 'red' } {
  switch (mode) {
    case 'OFFLINE': return { label: 'Offline (deterministic fallback)', tone: 'cyan' };
    case 'CONFIGURED': return { label: 'Configured — Not Verified', tone: 'orange' };
    case 'AVAILABLE': return { label: 'Real Provider Available', tone: 'green' };
    case 'DEGRADED': return { label: 'Degraded', tone: 'orange' };
    case 'UNAVAILABLE': return { label: 'Unavailable', tone: 'red' };
    default: return { label: mode, tone: 'slate' };
  }
}

/** Whether an operating mode means a genuine real provider is verified-available. */
export function isRealAvailable(mode: ProviderOperatingMode): boolean {
  return mode === 'AVAILABLE';
}

export function verificationStatusLabel(status: string): string {
  switch (status) {
    case 'REAL_PROVIDER_VERIFIED': return 'Real Provider Verified';
    case 'REAL_EMBEDDING_VERIFIED': return 'Real Embedding Verified';
    case 'DEGRADED': return 'Reached — Degraded';
    case 'UNAVAILABLE': return 'Unavailable';
    case 'NOT_CONFIGURED': return 'Not Configured';
    case 'COOLDOWN': return 'Cooldown';
    default: return 'Failed';
  }
}

/** Top-level status banner. Deterministic fallback is never shown as real AI. */
export function providerBanner(llm: ProviderOperatingMode, embedding: ProviderOperatingMode): { text: string; tone: 'cyan' | 'green' | 'orange' | 'red' } {
  if (llm === 'OFFLINE' && embedding === 'OFFLINE') return { text: 'OFFLINE MODE — deterministic fallback + LocalHashEmbedding (not real AI)', tone: 'cyan' };
  if (llm === 'UNAVAILABLE' || embedding === 'UNAVAILABLE') return { text: 'DEGRADED TO DETERMINISTIC FALLBACK — provider verification failed', tone: 'red' };
  if (llm === 'CONFIGURED' || embedding === 'CONFIGURED') return { text: 'PROVIDER CONFIGURED — NOT VERIFIED (run verification)', tone: 'orange' };
  if (llm === 'AVAILABLE' && embedding === 'AVAILABLE') return { text: 'REAL PROVIDER ACTIVE — LLM + embeddings verified', tone: 'green' };
  if (llm === 'AVAILABLE') return { text: 'REAL LLM AVAILABLE', tone: 'green' };
  if (embedding === 'AVAILABLE') return { text: 'REAL EMBEDDING PROVIDER AVAILABLE — re-embedding may be required', tone: 'green' };
  return { text: 'PROVIDER STATUS MIXED — review verification', tone: 'orange' };
}

export function pctOrDash(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
