/**
 * Real-vs-fallback comparison harness domain model (Phase 9).
 *
 * Compares REAL_PROVIDER vs DETERMINISTIC_FALLBACK behavior over fixed, versioned
 * ORION scenarios by exercising the EXISTING application services through their
 * existing LlmRunner path (no duplicate application logic). A real-provider call
 * that degrades to deterministic fallback is recorded as fallback — NEVER as
 * real-accepted. Failed live runs are preserved as failed.
 */
export const COMPARISON_DATASET_VERSION = 'orion-provider-comparison-v1';

export type ComparisonUseCase = 'PLANNER' | 'CRITIC';
export type ComparisonArm = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK';

export interface ComparisonResultRecord {
  scenarioKey: string;
  arm: ComparisonArm;
  useCase: ComparisonUseCase;
  executionMode: string;
  structuredOutputValid: boolean | null;
  groundingValid: boolean | null;
  citationValid: boolean | null;
  evidenceValid: boolean | null;
  policyValid: boolean | null;
  fallbackOccurred: boolean;
  failed: boolean;
  averageGroundingSupport: number | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ComparisonRunResult {
  comparisonRunId: number;
  correlationId: string;
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
  status: 'COMPLETED' | 'FAILED';
  results: ComparisonResultRecord[];
}
