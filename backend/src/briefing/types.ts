/**
 * Investigation briefing use-case types (Phase 4). The briefing layer is a thin
 * orchestration over Phase 3 retrieval + the reusable GroundedGenerationService.
 */
import type { GroundingCitation, GenerationDiagnostics, GeneratedBriefing, GenerationStatus } from '../generation/types.js';
import type { LlmExecutionMode } from '../llm/types.js';

/** Read-only briefing response returned by the API (bounded, no secrets/raw prompt). */
export interface BriefingResponse {
  investigationId: number;
  briefing: GeneratedBriefing | null;
  generationStatus: GenerationStatus;
  providerExecutionMode: LlmExecutionMode | null;
  retrievalMode: string | null;
  promptVersion: string;
  citations: GroundingCitation[];
  generationDiagnostics: GenerationDiagnostics;
  correlationId: string;
  /** Advisory-only reminder surfaced to the caller. */
  disclaimer: string;
}
