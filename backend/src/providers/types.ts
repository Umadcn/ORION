/**
 * Provider capability + verification domain model (Phase 9).
 *
 * Capabilities are ALWAYS explicit configuration or verified behavior — never
 * inferred from a provider name. Operating mode distinguishes "configured" from
 * "verified available": a configured provider is NOT automatically AVAILABLE;
 * AVAILABLE requires a successful live health/conformance check. Deterministic
 * fallback is never represented as real-provider success. No credentials are
 * ever represented in these types.
 */

export type ProviderKind = 'LLM' | 'EMBEDDING';

/**
 * OFFLINE     — no real provider configured (deterministic/local fallback only).
 * CONFIGURED  — real provider configured + allowlisted + trusted endpoint, but not yet verified.
 * AVAILABLE   — a live verification succeeded within the freshness window.
 * DEGRADED    — configured + previously/partly verified, but the latest verification did not fully pass.
 * UNAVAILABLE — configured but the latest verification failed (auth/network/etc.).
 */
export type ProviderOperatingMode = 'OFFLINE' | 'CONFIGURED' | 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';

export interface LlmProviderCapabilities {
  providerName: string;
  model: string | null;
  supportsStructuredOutput: boolean;
  supportsJsonSchema: boolean;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface EmbeddingProviderCapabilities {
  providerName: string;
  model: string | null;
  dimension: number;
  maxInputTokens: number;
  maxBatchSize: number;
  normalizedOutput: boolean;
}

export type VerificationType = 'LLM_GENERATION' | 'EMBEDDING';

/** Normalized outcome of a live verification. */
export type VerificationStatus =
  | 'REAL_PROVIDER_VERIFIED'      // LLM: genuine REAL_PROVIDER response accepted
  | 'REAL_EMBEDDING_VERIFIED'     // Embedding: genuine real vector accepted
  | 'DEGRADED'                    // reached provider but conformance imperfect
  | 'UNAVAILABLE'                 // provider not reachable / auth failed
  | 'NOT_CONFIGURED'              // no safely-configured provider
  | 'COOLDOWN'                    // called again within the cooldown window
  | 'FAILED';                     // unexpected failure

export interface VerificationResult {
  verificationId: number | null;
  correlationId: string;
  providerKind: ProviderKind;
  providerName: string;
  model: string | null;
  verificationType: VerificationType;
  status: VerificationStatus;
  /** True ONLY when a genuine external provider call succeeded and was accepted. */
  liveProviderReached: boolean;
  latencyMs: number;
  structuredOutputValid: boolean | null;
  embeddingDimensionValid: boolean | null;
  usageMetadataAvailable: boolean | null;
  normalizedErrorCode: string | null;
  sanitizedErrorMessage: string | null;
  createdAt: string;
}

export interface ProviderStatusSummary {
  kind: ProviderKind;
  providerName: string;
  model: string | null;
  operatingMode: ProviderOperatingMode;
  configuredSafely: boolean;
  allowlisted: boolean;
  endpointTrusted: boolean;
  lastVerificationStatus: VerificationStatus | null;
  lastVerifiedAt: string | null;
  verificationStale: boolean;
}
