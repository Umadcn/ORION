/**
 * Bounded, deterministic grounding-context construction (Phase 4, reusable).
 *
 * Separates TRUSTED deterministic system facts (investigation, RCA, evidence)
 * from UNTRUSTED retrieved document context (knowledge chunks). Enforces size,
 * count, and per-source bounds with deterministic truncation. Runs prompt-
 * injection detection over retrieved chunks and excludes/annotates per policy.
 *
 * It never includes secrets, credentials, Authorization headers, raw embedding
 * vectors, unrestricted DB rows, or evidence/chunks from other investigations.
 */
import { config } from '../config.js';
import type { Evidence, Investigation, RootCause, Satellite } from '../types.js';
import type { RetrievalResult } from '../knowledge/types.js';
import type {
  ContextDiagnostics,
  GenerationUseCase,
  GroundedGenerationContext,
  GroundingCitation,
  GroundingEvidence,
  GroundingSource,
  SystemFacts,
} from './types.js';

/** Map an authoritative deterministic root cause to a knowledge subsystem tag. */
export function rootCauseToSubsystem(rc: RootCause | null): string | null {
  switch (rc) {
    case 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION':
    case 'BATTERY_DEGRADATION':
      return 'POWER';
    case 'THERMAL_CONTROL_FAILURE':
      return 'THERMAL';
    case 'COMMUNICATION_SUBSYSTEM_FAILURE':
      return 'COMMUNICATIONS';
    default:
      return null;
  }
}

/** Humanize an enum-ish label ("PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION" -> "payload power subsystem malfunction"). */
export function humanize(value: string | null): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').toLowerCase();
}

// Instruction-like patterns that should never be treated as instructions when
// found inside retrieved (untrusted) document content.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(the\s+)?(previous|prior|system)/i,
  /system\s+prompt/i,
  /you\s+are\s+now\b/i,
  /\bact\s+as\b/i,
  /\bassistant\s*:/i,
  /override\s+(the\s+)?(instructions|policy|system)/i,
  /reveal\s+(the\s+)?(secret|api[_-]?key|password|token|system prompt)/i,
  /print\s+(the\s+)?(system prompt|secret|api[_-]?key)/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max).trimEnd(), truncated: true };
}

export interface ContextBuilderInput {
  useCase: GenerationUseCase;
  investigation: Investigation;
  satellite: Satellite | null;
  evidence: Evidence[];
  retrieval: RetrievalResult;
}

/** Build a bounded grounding context. Pure + deterministic for fixed inputs. */
export function buildGroundingContext(input: ContextBuilderInput): GroundedGenerationContext {
  const g = config.generation;
  const { investigation, satellite, evidence, retrieval } = input;

  let anomalyTypes: string[] = [];
  try {
    anomalyTypes = JSON.parse(investigation.detected_anomalies) as string[];
  } catch {
    anomalyTypes = [];
  }

  const subsystem = rootCauseToSubsystem(investigation.root_cause);
  const systemFacts: SystemFacts = {
    investigationId: investigation.id,
    title: investigation.title,
    satelliteId: investigation.satellite_id,
    satelliteName: satellite?.name ?? null,
    subsystem,
    anomalyTypes,
    authoritativeRootCause: investigation.root_cause ?? 'UNKNOWN_ANOMALY',
    authoritativeRootCauseLabel: humanize(investigation.root_cause),
    hasDeterministicRca: investigation.root_cause !== null,
    severity: investigation.severity,
    rcaConfidence: investigation.confidence,
    status: investigation.status,
    explanation: investigation.explanation,
  };

  let totalChars = systemFacts.explanation?.length ?? 0;
  let truncated = false;

  // --- Deterministic evidence (trusted). Prefer supporting evidence, stable by id. ---
  const orderedEvidence = [...evidence].sort((a, b) => {
    if (a.supports_root_cause !== b.supports_root_cause) return b.supports_root_cause - a.supports_root_cause;
    return a.id - b.id;
  });
  const groundingEvidence: GroundingEvidence[] = [];
  for (const e of orderedEvidence) {
    if (groundingEvidence.length >= g.maxEvidenceItems) break;
    const t = truncate(e.summary, g.maxTextPerSource);
    truncated = truncated || t.truncated;
    totalChars += t.text.length;
    groundingEvidence.push({ evidenceId: String(e.id), sourceType: e.source_type, summary: e.summary.slice(0, g.maxTextPerSource), text: t.text });
  }

  // --- Retrieved knowledge chunks (untrusted). Injection filter + bounds. ---
  const sources: GroundingSource[] = [];
  const citations: GroundingCitation[] = [];
  let excludedSourceCount = 0;
  let injectionFlagCount = 0;

  for (const item of retrieval.items) {
    const flagged = detectInjection(item.content);
    if (flagged) injectionFlagCount++;
    // Enforce count + character budget deterministically.
    const overCount = sources.length >= g.maxRetrievalChunks;
    const t = truncate(item.content, g.maxTextPerSource);
    const overBudget = totalChars + t.text.length > g.maxContextChars;
    if ((flagged && g.injectionFilterEnabled) || overCount || overBudget) {
      excludedSourceCount++;
      if (overBudget || overCount) truncated = true;
      continue;
    }
    truncated = truncated || t.truncated;
    totalChars += t.text.length;
    sources.push({
      citationId: item.citationId,
      documentId: item.documentId,
      stableDocumentId: item.stableDocumentId,
      title: item.title,
      sourceType: item.sourceType,
      text: t.text,
      relevance: item.rerankScore ?? item.rrfScore ?? item.similarity ?? item.bm25Score ?? null,
      injectionFlagged: flagged,
    });
    citations.push({ citationId: item.citationId, documentId: item.documentId, title: item.title });
  }

  const diagnostics: ContextDiagnostics = {
    includedEvidenceCount: groundingEvidence.length,
    includedCitationCount: citations.length,
    includedSourceCount: sources.length,
    excludedSourceCount,
    injectionFlagCount,
    totalContextChars: totalChars,
    truncated,
  };

  return {
    useCase: input.useCase,
    investigationId: investigation.id,
    systemFacts,
    evidence: groundingEvidence,
    sources,
    citations,
    allowedCitationIds: sources.map((s) => s.citationId),
    allowedEvidenceIds: groundingEvidence.map((e) => e.evidenceId),
    diagnostics,
  };
}
