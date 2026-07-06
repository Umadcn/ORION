/**
 * GroundedGenerationService (Phase 4) — the reusable retrieval-augmented
 * generation engine. This is the ONLY place that invokes the LLM for generation,
 * and it does so exclusively through the Phase 1 LlmRunner (no direct provider
 * calls). Real-provider output and deterministic-fallback output are validated
 * through the SAME pipeline (schema → citation → evidence → grounding → policy),
 * gated deterministically, and audited.
 *
 * Deterministic-fallback design (documented choice): the service builds the
 * domain-specific deterministic briefing up front and passes it to LlmRunner as
 * the `fallbackSeed`. When the runner returns DETERMINISTIC_FALLBACK (e.g. no
 * real provider configured), the service uses that domain briefing as the
 * candidate — guaranteeing a schema-correct, grounded briefing — and labels the
 * outcome DETERMINISTIC_FALLBACK_ACCEPTED. Fallback output is NEVER labeled real.
 * If a real-provider output is rejected, the service safely degrades to the
 * deterministic briefing (recording the rejection reason) rather than emitting
 * ungrounded content.
 */
import { db } from '../db.js';
import { config, redactSecrets } from '../config.js';
import { LlmRunner, llmRunner } from '../llm/runner.js';
import { getLlmExecutionIdByCorrelation } from '../services/llmAuditService.js';
import { validateJsonSchema } from '../llm/schema.js';
import { BRIEFING_SCHEMA, BRIEFING_SCHEMA_NAME } from './schemas.js';
import { validateCitations } from './citationValidator.js';
import { validateEvidence } from './evidenceValidator.js';
import { validateGrounding } from './groundingValidator.js';
import { validatePolicy } from './policyValidator.js';
import { runQualityGate } from './qualityGate.js';
import { generationRepo } from './repository.js';
import type {
  ContextSufficiencyResult,
  GeneratedBriefing,
  GenerationDiagnostics,
  GenerationStatus,
  GroundedGenerationRequest,
  GroundedGenerationResult,
  QualityGateResult,
} from './types.js';
import type { LlmExecutionMode } from '../llm/types.js';

function knownSatelliteIds(): Set<string> {
  const rows = db.prepare('SELECT id FROM satellites').all() as { id: string }[];
  return new Set(rows.map((r) => r.id.toUpperCase()));
}

/** Context sufficiency gate — evaluated once, before any provider call. */
function evaluateSufficiency(req: GroundedGenerationRequest): ContextSufficiencyResult {
  const g = config.generation;
  const ctx = req.context;
  const reasons: string[] = [];
  if (!ctx.systemFacts.hasDeterministicRca) reasons.push('no deterministic RCA');
  if (!ctx.systemFacts.satelliteId) reasons.push('missing satellite');
  if (ctx.evidence.length < 1) reasons.push('no deterministic evidence');
  if (ctx.sources.length < g.minRetrievalChunks) reasons.push(`retrieved chunks < ${g.minRetrievalChunks}`);
  return { sufficient: reasons.length === 0, reasons };
}

function validateAll(briefing: GeneratedBriefing, req: GroundedGenerationRequest, sufficiency: ContextSufficiencyResult): QualityGateResult {
  const schemaRes = validateJsonSchema(BRIEFING_SCHEMA, briefing);
  const schema = { valid: schemaRes.valid, errors: schemaRes.errors };
  const citation = validateCitations(briefing, req.context);
  const evidence = validateEvidence(briefing, req.context, req.investigationId);
  const grounding = validateGrounding(briefing, req.context);
  const policy = validatePolicy(briefing, req.context, knownSatelliteIds());
  return runQualityGate({ sufficiency, schema, citation, evidence, grounding, policy });
}

const DECISION_TO_STATUS: Record<Exclude<QualityGateResult['decision'], 'ACCEPT'>, GenerationStatus> = {
  REJECT_CONTEXT_INSUFFICIENT: 'REJECTED_CONTEXT_INSUFFICIENT',
  REJECT_SCHEMA: 'REJECTED_SCHEMA_INVALID',
  REJECT_INVALID_CITATION: 'REJECTED_INVALID_CITATION',
  REJECT_INVALID_EVIDENCE: 'REJECTED_INVALID_EVIDENCE',
  REJECT_UNGROUNDED: 'REJECTED_UNGROUNDED',
  REJECT_POLICY: 'REJECTED_POLICY_VIOLATION',
};

export class GroundedGenerationService {
  private runner: LlmRunner;
  constructor(deps: { runner?: LlmRunner } = {}) {
    this.runner = deps.runner ?? llmRunner;
  }

  async generate(req: GroundedGenerationRequest): Promise<GroundedGenerationResult> {
    const started = Date.now();
    const sufficiency = evaluateSufficiency(req);

    const baseResult = {
      useCase: req.useCase,
      correlationId: req.correlationId,
      investigationId: req.investigationId,
      promptVersion: req.promptVersion,
      retrievalExecutionId: req.retrievalExecutionId ?? null,
      retrievalMode: req.retrievalMode ?? null,
    };

    // --- Context sufficiency gate: never call the provider unnecessarily. ---
    if (!sufficiency.sufficient) {
      return this.finalize({
        ...baseResult, status: 'REJECTED_CONTEXT_INSUFFICIENT', providerExecutionMode: null,
        provider: null, model: null, llmExecutionId: null, briefing: null,
        gate: null, sufficiency, fallbackReason: null,
        rejectionReason: `context insufficient: ${sufficiency.reasons.join('; ')}`,
        started, createdBy: req.createdBy ?? null, contextDiag: req.context.diagnostics,
      });
    }

    // --- Single provider execution path: LlmRunner. ---
    const response = await this.runner.run<GeneratedBriefing>({
      requestType: req.useCase,
      promptVersion: req.promptVersion,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      structuredOutput: { name: BRIEFING_SCHEMA_NAME, schema: BRIEFING_SCHEMA },
      fallbackSeed: req.deterministicFallback,
      correlationId: req.correlationId,
      investigationId: req.investigationId,
    });

    const providerExecutionMode: LlmExecutionMode = response.executionMode;
    const llmExecutionId = getLlmExecutionIdByCorrelation(req.correlationId);
    const provider = response.provider;
    const model = response.model;

    // --- Provider FAILED (fallback disabled) -> fail safely. ---
    if (response.executionMode === 'FAILED') {
      return this.finalize({
        ...baseResult, status: 'FAILED', providerExecutionMode, provider, model, llmExecutionId,
        briefing: null, gate: null, sufficiency, fallbackReason: null,
        rejectionReason: response.error?.code ? `provider failed: ${response.error.code}` : 'provider failed',
        sanitizedError: response.error ? redactSecrets(response.error.message).slice(0, 300) : null,
        started, createdBy: req.createdBy ?? null, contextDiag: req.context.diagnostics,
      });
    }

    // --- Choose candidate. Fallback mode uses the DOMAIN deterministic briefing. ---
    let candidate: GeneratedBriefing;
    let source: 'REAL' | 'FALLBACK';
    if (response.executionMode === 'REAL_PROVIDER' && response.structured) {
      candidate = response.structured;
      source = 'REAL';
    } else {
      candidate = req.deterministicFallback;
      source = 'FALLBACK';
    }

    let gate = validateAll(candidate, req, sufficiency);
    let fallbackReason: string | null = null;

    // --- Safe degrade: rejected real output falls back to the grounded fallback. ---
    if (gate.decision !== 'ACCEPT' && source === 'REAL') {
      const fbGate = validateAll(req.deterministicFallback, req, sufficiency);
      if (fbGate.decision === 'ACCEPT') {
        fallbackReason = `REAL_REJECTED:${gate.decision}`;
        candidate = req.deterministicFallback;
        source = 'FALLBACK';
        gate = fbGate;
      }
    }

    let status: GenerationStatus;
    let briefing: GeneratedBriefing | null;
    let rejectionReason: string | null = null;
    if (gate.decision === 'ACCEPT') {
      status = source === 'REAL' ? 'REAL_PROVIDER_ACCEPTED' : 'DETERMINISTIC_FALLBACK_ACCEPTED';
      briefing = candidate;
    } else {
      status = DECISION_TO_STATUS[gate.decision];
      briefing = null;
      rejectionReason = gate.decision;
    }

    return this.finalize({
      ...baseResult, status, providerExecutionMode, provider, model, llmExecutionId,
      briefing, gate, sufficiency, fallbackReason, rejectionReason, started, createdBy: req.createdBy ?? null,
      contextDiag: req.context.diagnostics,
    });
  }

  private finalize(p: {
    useCase: GroundedGenerationRequest['useCase']; correlationId: string; investigationId: number;
    promptVersion: string; retrievalExecutionId: number | null; retrievalMode: string | null;
    status: GenerationStatus; providerExecutionMode: LlmExecutionMode | null; provider: string | null;
    model: string | null; llmExecutionId: number | null; briefing: GeneratedBriefing | null;
    gate: QualityGateResult | null; sufficiency: ContextSufficiencyResult; fallbackReason: string | null;
    rejectionReason: string | null; sanitizedError?: string | null; started: number; createdBy: string | null;
    contextDiag: import('./types.js').ContextDiagnostics;
  }): GroundedGenerationResult {
    const latencyMs = Date.now() - p.started;
    const gr = p.gate?.grounding;
    const cd = p.contextDiag;
    const diagnostics: GenerationDiagnostics = {
      contextSourceCount: cd.includedSourceCount,
      includedEvidenceCount: cd.includedEvidenceCount,
      includedCitationCount: cd.includedCitationCount,
      excludedSourceCount: cd.excludedSourceCount,
      injectionFlagCount: cd.injectionFlagCount,
      claimCount: gr?.claimCount ?? 0,
      supportedClaimCount: gr?.supportedClaimCount ?? 0,
      unsupportedClaimCount: gr?.unsupportedClaimCount ?? 0,
      averageGroundingSupport: gr?.averageSupport ?? null,
      schemaValid: p.gate?.schema.valid ?? false,
      citationValid: p.gate?.citation.valid ?? false,
      evidenceValid: p.gate?.evidence.valid ?? false,
      groundingValid: p.gate?.grounding.valid ?? false,
      policyValid: p.gate?.policy.valid ?? false,
      contextSufficient: p.sufficiency.sufficient,
      rejectionReason: p.rejectionReason,
      policyViolations: p.gate?.policy.violations ?? [],
    };

    generationRepo.create({
      correlation_id: p.correlationId, investigation_id: p.investigationId, use_case: p.useCase,
      generation_status: p.status, llm_execution_id: p.llmExecutionId, provider_execution_mode: p.providerExecutionMode,
      provider: p.provider, model: p.model, prompt_version: p.promptVersion,
      retrieval_execution_id: p.retrievalExecutionId, retrieval_mode: p.retrievalMode,
      context_source_count: cd.includedSourceCount, included_evidence_count: cd.includedEvidenceCount,
      included_citation_count: cd.includedCitationCount,
      excluded_source_count: cd.excludedSourceCount, injection_flag_count: cd.injectionFlagCount,
      schema_valid: p.gate ? p.gate.schema.valid : null,
      citation_valid: p.gate ? p.gate.citation.valid : null,
      evidence_valid: p.gate ? p.gate.evidence.valid : null,
      grounding_valid: p.gate ? p.gate.grounding.valid : null,
      policy_valid: p.gate ? p.gate.policy.valid : null,
      context_sufficient: p.sufficiency.sufficient,
      claim_count: gr?.claimCount ?? 0, supported_claim_count: gr?.supportedClaimCount ?? 0,
      unsupported_claim_count: gr?.unsupportedClaimCount ?? 0, average_grounding_support: gr?.averageSupport ?? null,
      latency_ms: latencyMs, fallback_reason: p.fallbackReason, rejection_reason: p.rejectionReason,
      sanitized_error_message: p.sanitizedError ?? null, created_by: p.createdBy,
    });

    return {
      status: p.status, useCase: p.useCase, correlationId: p.correlationId, investigationId: p.investigationId,
      providerExecutionMode: p.providerExecutionMode, provider: p.provider, model: p.model,
      promptVersion: p.promptVersion, llmExecutionId: p.llmExecutionId,
      retrievalExecutionId: p.retrievalExecutionId, retrievalMode: p.retrievalMode,
      briefing: p.briefing, diagnostics, fallbackReason: p.fallbackReason, latencyMs,
    };
  }
}

export const groundedGenerationService = new GroundedGenerationService();
