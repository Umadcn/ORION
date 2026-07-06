/**
 * ORION AI Assistant orchestration (Phase 10).
 *
 * READ-ONLY. Uses LlmRunner ONLY (no direct provider calls). The Phase 5 Copilot
 * upgraded into a full agentic assistant:
 *   user message → bounded memory → intent routing → context resolution →
 *   capability selection (allowlisted, RBAC, fail-closed) → bounded execution
 *   (workflows + dynamic tool calling + Agentic RAG) → grounded answer
 *   (real-provider OR deterministic) → quality gate → persisted, audited result.
 *
 * Real-provider output and the deterministic fallback pass through the SAME
 * quality gate; deterministic output is NEVER labeled real. A real answer that
 * fails the gate is recorded REAL_REJECTED and degraded to deterministic
 * fallback. Mission state is never mutated; the deterministic RCA is preserved.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config, isRealLlmConfigured, redactSecrets } from '../config.js';
import { LlmRunner, llmRunner } from '../llm/runner.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import { resolveSatelliteExact, listSatelliteIds } from '../services/satelliteService.js';
import { validateAlignment } from './answerAlignment.js';
import { requireOwnedConversation } from '../copilot/conversationService.js';
import * as convRepo from '../copilot/conversationRepository.js';
import type { ToolAuditRef } from '../copilot/toolExecutor.js';
import type { CopilotGroundingContext, ToolCall, ToolContext, ToolExecutionResult, MessageRow } from '../copilot/types.js';
import { CopilotValidationError } from '../copilot/copilotService.js';
import type { Role } from '../auth/users.js';

import { AssistantExecutor, assistantExecutor, createToolRunner, type AssistantAssembly } from './deterministicAssistant.js';
import { AssistantIntentRouter, assistantIntentRouter } from './intentRouter.js';
import { AssistantMemoryService, assistantMemoryService } from './memoryService.js';
import { resolveContext } from './contextResolution.js';
import { getCapability, capabilityForIntent } from './capabilities.js';
import { validateAssistantAnswer } from './assistantValidators.js';
import { ASSISTANT_STEP_SCHEMA, ASSISTANT_STEP_SCHEMA_NAME } from './assistantSchemas.js';
import { ASSISTANT_VERSION, ASSISTANT_SYSTEM_PROMPT, buildAssistantUserPrompt } from './prompt.js';
import * as repo from './assistantRepository.js';
import type {
  AssistantAnswer, AssistantCapability, AssistantConversationContext, AssistantEvent, AssistantEventSink,
  AssistantExecutionMode, AssistantExecutionResult, AssistantExecutionStatus, AssistantIntent,
} from './types.js';

const DISCLAIMER =
  'Read-only ORION AI Assistant. The deterministic root-cause analysis is authoritative; retrieved documents ' +
  'are supporting context. Retrieval scores and grounding support are not confidence. Planner/Critic output is ' +
  'advisory analysis-quality review only (never a mission decision) and requires human review. ' +
  'DETERMINISTIC_FALLBACK answers are not real LLM output.';

const ANSWER_VERSION = ASSISTANT_VERSION;

export interface AssistantDeps {
  runner?: LlmRunner;
  realProviderAvailable?: boolean;
  executor?: AssistantExecutor;
  intentRouter?: AssistantIntentRouter;
  memory?: AssistantMemoryService;
}

export class AssistantService {
  private runner: LlmRunner;
  private realAvailable: boolean;
  private executor: AssistantExecutor;
  private router: AssistantIntentRouter;
  private memory: AssistantMemoryService;

  constructor(deps: AssistantDeps = {}) {
    this.runner = deps.runner ?? llmRunner;
    this.realAvailable = deps.realProviderAvailable ?? isRealLlmConfigured();
    this.executor = deps.executor ?? assistantExecutor;
    this.router = deps.intentRouter ?? assistantIntentRouter;
    this.memory = deps.memory ?? assistantMemoryService;
  }

  async ask(params: { conversationId: string; userId: string; role: Role; message: string }, sink?: AssistantEventSink): Promise<AssistantExecutionResult> {
    const started = Date.now();
    const correlationId = crypto.randomUUID();
    requireOwnedConversation(params.conversationId, params.userId); // 404 if not owned (cross-user isolation)

    const rawMessage = String(params.message ?? '');
    if (rawMessage.trim().length === 0) throw new CopilotValidationError('message is required');
    if (rawMessage.length > config.assistant.maxMessageChars) throw new CopilotValidationError(`message exceeds ${config.assistant.maxMessageChars} chars`);
    const message = rawMessage;

    // Event plumbing (bounded).
    let seq = 0;
    const events: AssistantEvent[] = [];
    const emit = (e: Omit<AssistantEvent, 'seq'>) => {
      if (seq >= config.assistant.maxEvents) return;
      const ev: AssistantEvent = { ...e, seq: seq++ };
      events.push(ev);
      try { sink?.(e); } catch { /* ignore sink errors */ }
    };

    convRepo.addMessage(params.conversationId, 'user', message.slice(0, config.assistant.maxMessageChars), null, correlationId);
    emit({ type: 'ASSISTANT_STARTED' });

    // --- Bounded memory: retained window + optional summarization. ---
    const priorContext = repo.getConversationContext(params.conversationId);
    await this.memory.maybeSummarize(params.conversationId, correlationId).catch(() => null);
    const summaryRow = repo.getConversationSummary(params.conversationId);
    const summary = summaryRow?.summary ?? null;
    const history = this.retained(params.conversationId);

    // --- Intent routing. ---
    const routed = await this.router.classify(message, priorContext, history, correlationId);
    emit({ type: 'INTENT_CLASSIFIED', detail: routed.intent });

    // --- Prohibited / unsupported fail safely before any tool/workflow. ---
    if (routed.intent === 'PROHIBITED') {
      return this.finish(params, correlationId, started, events, sink, {
        intent: routed.intent, capability: null, context: priorContext, executionMode: 'DETERMINISTIC_FALLBACK',
        status: 'REFUSED', answer: refusalAnswer(), assembly: null, provider: null, model: null, quality: 'REFUSED',
        contextResolved: false, inputTokens: null, outputTokens: null,
      });
    }

    // --- Conversational / meta intents: answered DIRECTLY, ZERO retrieval, zero tools. ---
    if (routed.intent === 'GREETING' || routed.intent === 'THANKS' || routed.intent === 'CAPABILITIES' || routed.intent === 'OUT_OF_SCOPE') {
      const answer = routed.intent === 'GREETING' ? greetingAnswer()
        : routed.intent === 'THANKS' ? thanksAnswer()
        : routed.intent === 'CAPABILITIES' ? capabilitiesAnswer()
        : outOfScopeAnswer();
      answer.suggested_followups = conversationalFollowups();
      return this.finish(params, correlationId, started, events, sink, {
        intent: routed.intent, capability: null, context: priorContext, executionMode: 'DETERMINISTIC_FALLBACK',
        status: 'DETERMINISTIC', answer, assembly: null, provider: null, model: null, quality: 'DIRECT_CONVERSATION',
        contextResolved: false, inputTokens: null, outputTokens: null, groundingValid: true, policyValid: true,
      });
    }

    // --- Satellite lookup: resolve existence against authoritative storage BEFORE any retrieval. ---
    if (routed.intent === 'SATELLITE_LOOKUP') {
      const candidate = routed.entities.satelliteCandidate;
      const sat = candidate ? resolveSatelliteExact(candidate) : undefined;
      if (!sat) {
        return this.finish(params, correlationId, started, events, sink, {
          intent: 'SATELLITE_LOOKUP', capability: null, context: priorContext, executionMode: 'DETERMINISTIC_FALLBACK',
          status: 'DETERMINISTIC', answer: satelliteNotFoundAnswer(candidate, listSatelliteIds({ limit: 8 })), assembly: null,
          provider: null, model: null, quality: 'NOT_FOUND', contextResolved: false, inputTokens: null, outputTokens: null,
          groundingValid: true, policyValid: true,
        });
      }
      // Exists → treat as a structured satellite status lookup (no RAG).
      routed.intent = 'SATELLITE_STATUS';
      routed.entities.satelliteId = sat.id;
    }

    // --- Context resolution (validated against authoritative data). ---
    const resolution = resolveContext(routed.intent, routed.entities, priorContext);
    const context = resolution.resolved;
    emit({ type: 'CONTEXT_RESOLVED', detail: resolution.resolvedFromReference.join(',') || 'fresh' });

    // --- Capability selection (allowlisted, fail-closed). ---
    let intent: AssistantIntent = routed.intent;
    if (intent === 'FOLLOW_UP') intent = (priorContext.lastCapability as AssistantIntent) ?? 'MISSION_QA';
    if (intent === 'UNSUPPORTED') {
      return this.finish(params, correlationId, started, events, sink, {
        intent: routed.intent, capability: null, context, executionMode: 'DETERMINISTIC_FALLBACK',
        status: 'REFUSED', answer: unsupportedAnswer(), assembly: null, provider: null, model: null, quality: 'UNSUPPORTED',
        contextResolved: resolution.resolvedFromReference.length > 0, inputTokens: null, outputTokens: null,
      });
    }
    const capabilityId = capabilityForIntent(intent);
    const capability = capabilityId ? getCapability(capabilityId) : undefined;
    if (!capability) {
      return this.finish(params, correlationId, started, events, sink, {
        intent: routed.intent, capability: null, context, executionMode: 'DETERMINISTIC_FALLBACK',
        status: 'REFUSED', answer: unsupportedAnswer(), assembly: null, provider: null, model: null, quality: 'UNSUPPORTED',
        contextResolved: false, inputTokens: null, outputTokens: null,
      });
    }

    // --- RBAC (capability-level, on top of route auth). ---
    if (capability.requiredRoles && !capability.requiredRoles.includes(params.role)) {
      return this.finish(params, correlationId, started, events, sink, {
        intent, capability: capability.id, context, executionMode: 'DETERMINISTIC_FALLBACK',
        status: 'REFUSED', answer: forbiddenAnswer(capability.id), assembly: null, provider: null, model: null, quality: 'FORBIDDEN',
        contextResolved: true, inputTokens: null, outputTokens: null,
      });
    }

    // --- Bounded execution: workflows/source first, then real loop or deterministic. ---
    const execCtx: ToolContext = { userId: params.userId, role: params.role, correlationId };
    const auditRef: ToolAuditRef = { correlationId, conversationId: params.conversationId, messageId: null, executionMode: this.realAvailable ? 'REAL_PROVIDER' : 'DETERMINISTIC_FALLBACK' };
    const asm = this.executor.newAssembly(context);
    const runTool = createToolRunner(asm, capability, execCtx, auditRef, emit);
    const p = { capability, message, context, inspectCitationId: resolution.inspectCitationId, execCtx, auditRef, emit };

    await this.executor.preExecute(p, asm, runTool);

    let candidate: AssistantAnswer | null = null;
    let source: 'REAL' | 'FALLBACK' = 'FALLBACK';
    let provider: string | null = null;
    let model: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let fallbackReason: string | null = null;
    let terminationReason = 'DETERMINISTIC';

    const availableWorkflowRefs = this.workflowRefs(asm);

    if (this.realAvailable) {
      const loop = await this.realProviderLoop(capability, p, asm, runTool, summary, history, () => Date.now() - started);
      provider = loop.provider; model = loop.model; inputTokens = loop.inputTokens; outputTokens = loop.outputTokens;
      terminationReason = loop.terminationReason;
      if (loop.answer) {
        emit({ type: 'VALIDATING_ANSWER' });
        const v = validateAssistantAnswer(loop.answer, asm.grounding, availableWorkflowRefs);
        if (v.accepted) { candidate = loop.answer; source = 'REAL'; }
        else { fallbackReason = `REAL_REJECTED:${v.gate}`; }
      } else {
        fallbackReason = terminationReason === 'NO_REAL_PROVIDER' ? 'NO_REAL_PROVIDER' : `REAL_INCOMPLETE:${terminationReason}`;
      }
    }

    // Deterministic fallback (also the offline path). Passes the SAME gate.
    if (!candidate) {
      await this.executor.buildDeterministicPlan(p, asm, runTool);
      candidate = asm.answer;
      source = 'FALLBACK';
      terminationReason = this.realAvailable ? terminationReason : 'DETERMINISTIC';
      emit({ type: 'VALIDATING_ANSWER' });
    }

    // Quality gate on the chosen answer.
    let validation = validateAssistantAnswer(candidate, asm.grounding, availableWorkflowRefs);
    let executionMode: AssistantExecutionMode = source === 'REAL' ? 'REAL_PROVIDER' : 'DETERMINISTIC_FALLBACK';
    let status: AssistantExecutionStatus;

    if (source === 'REAL' && validation.accepted) {
      status = 'ACCEPTED';
    } else if (asm.insufficient && (candidate.claims.length === 0)) {
      status = 'INSUFFICIENT_EVIDENCE';
      executionMode = 'INSUFFICIENT_EVIDENCE';
    } else if (validation.accepted) {
      status = 'DETERMINISTIC';
    } else {
      // Safety net: even deterministic failed the gate → safe insufficient answer.
      candidate = safeInsufficientAnswer(candidate.suggested_followups);
      validation = validateAssistantAnswer(candidate, asm.grounding, availableWorkflowRefs);
      status = 'INSUFFICIENT_EVIDENCE';
      executionMode = 'INSUFFICIENT_EVIDENCE';
    }

    // --- Answer↔question alignment validation (deterministic). ---
    // If the final answer does not actually address the resolved intent, degrade
    // to a safe insufficient-evidence answer rather than returning a mismatch.
    const alignment = validateAlignment(intent, candidate, { hasCitations: candidate.citations.length > 0 });
    if (!alignment.aligned && status !== 'INSUFFICIENT_EVIDENCE') {
      candidate = safeInsufficientAnswer(candidate.suggested_followups);
      status = 'INSUFFICIENT_EVIDENCE';
      executionMode = 'INSUFFICIENT_EVIDENCE';
      terminationReason = `ALIGNMENT_FAILED:${alignment.reason}`;
    }

    // Attach rich content + suggested follow-ups (bounded).
    const richContent = asm.richContent.slice(0, config.assistant.maxRichContentItems);
    const suggestedFollowups = (candidate.suggested_followups.length ? candidate.suggested_followups : defaultFollowups(capability.id))
      .slice(0, config.assistant.maxSuggestedFollowups);
    candidate.rich_content = richContent;
    candidate.suggested_followups = suggestedFollowups;

    return this.finish(params, correlationId, started, events, sink, {
      intent, capability: capability.id, context, executionMode, status, answer: candidate, assembly: asm,
      provider, model, quality: validation.gate, contextResolved: resolution.resolvedFromReference.length > 0 || asm.toolCallCount > 0,
      inputTokens, outputTokens, fallbackReason, averageSupport: validation.averageSupport,
      supportedClaimCount: validation.supportedClaimCount, groundingValid: validation.groundingValid,
      policyValid: validation.policyValid, terminationReason,
    });
  }

  // --- Real-provider bounded tool-calling loop (dynamic tool selection). ----
  private async realProviderLoop(
    capability: AssistantCapability,
    p: { message: string; context: AssistantConversationContext },
    asm: AssistantAssembly,
    runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>,
    summary: string | null,
    history: MessageRow[],
    elapsed: () => number,
  ): Promise<{ answer: AssistantAnswer | null; terminationReason: string; provider: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null }> {
    const allowed = new Set(capability.tools);
    let provider: string | null = null;
    let model: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    const seenCalls = new Set<string>();

    for (let i = 0; i < Math.min(capability.maxToolCalls + 1, config.assistant.maxIterations); i++) {
      if (elapsed() > capability.timeoutMs) return { answer: null, terminationReason: 'TIMEOUT', provider, model, inputTokens, outputTokens };
      asm.iterationCount++;

      const userPrompt = buildAssistantUserPrompt({
        message: p.message, capabilityId: capability.id, context: p.context, summary, history,
        toolResults: [], citations: [...asm.grounding.citationText].map(([citationId, text]) => ({ citationId, text })),
        evidenceIds: [...asm.grounding.allowedEvidenceIds], workflowSummaries: asm.workflowResults.map((w) => w.summary),
      });
      const resp = await this.runner.run<import('./types.js').AssistantAnswer & { type?: string; tool_calls?: ToolCall[]; answer?: string }>({
        requestType: 'assistant-step', promptVersion: ANSWER_VERSION,
        messages: [{ role: 'system', content: ASSISTANT_SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
        structuredOutput: { name: ASSISTANT_STEP_SCHEMA_NAME, schema: ASSISTANT_STEP_SCHEMA },
        correlationId: undefined,
      });
      provider = resp.provider; model = resp.model;
      inputTokens = resp.usage?.inputTokens ?? inputTokens; outputTokens = resp.usage?.outputTokens ?? outputTokens;
      if (resp.executionMode !== 'REAL_PROVIDER' || !resp.structured) {
        return { answer: null, terminationReason: 'NO_REAL_PROVIDER', provider, model, inputTokens, outputTokens };
      }
      const step = resp.structured as { type?: string; tool_calls?: ToolCall[] } & AssistantAnswer;
      if (step.type === 'TOOL_REQUEST' && Array.isArray(step.tool_calls)) {
        for (const c of step.tool_calls) {
          if (asm.toolCallCount >= capability.maxToolCalls) break;
          if (!allowed.has(String(c?.tool_name))) { asm.toolActivity.push({ toolCallId: String(c?.tool_call_id ?? 'tc'), toolName: String(c?.tool_name ?? ''), status: 'REJECTED', validationStatus: 'FORBIDDEN', summary: 'tool not permitted for capability', latencyMs: 0 }); continue; }
          const key = `${c.tool_name}:${JSON.stringify(c.arguments ?? {})}`;
          if (seenCalls.has(key)) continue; // duplicate tool-call detection
          seenCalls.add(key);
          const isRetrieval = c.tool_name === 'searchMissionKnowledge' || c.tool_name === 'searchHistoricalInvestigations';
          await runTool(c, isRetrieval);
        }
        continue;
      }
      if (step.type === 'FINAL_ANSWER') {
        return { answer: mapStepToAnswer(step), terminationReason: 'FINAL_ANSWER', provider, model, inputTokens, outputTokens };
      }
      return { answer: null, terminationReason: 'INVALID_STEP', provider, model, inputTokens, outputTokens };
    }
    return { answer: null, terminationReason: 'ITERATION_LIMIT', provider, model, inputTokens, outputTokens };
  }

  private retained(conversationId: string): MessageRow[] {
    const n = config.assistant.maxRetainedMessages;
    const rows = db.prepare('SELECT * FROM copilot_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?').all(conversationId, n) as MessageRow[];
    return rows.reverse();
  }

  private workflowRefs(asm: AssistantAssembly): Set<string> {
    const refs = new Set<string>();
    for (const w of asm.workflowResults) {
      if (w.plannerExecutionId !== null) refs.add(`PLANNER:${w.plannerExecutionId}`);
      if (w.criticExecutionId !== null) refs.add(`CRITIC:${w.criticExecutionId}`);
    }
    return refs;
  }

  // --- Finalize: persist, audit, update state, return result. ---------------
  private finish(
    params: { conversationId: string; userId: string; role: Role; message: string },
    correlationId: string, started: number, events: AssistantEvent[], sink: AssistantEventSink | undefined,
    o: {
      intent: AssistantIntent; capability: AssistantExecutionResult['diagnostics']['capability']; context: AssistantConversationContext;
      executionMode: AssistantExecutionMode; status: AssistantExecutionStatus; answer: AssistantAnswer; assembly: AssistantAssembly | null;
      provider: string | null; model: string | null; quality: string; contextResolved: boolean;
      inputTokens: number | null; outputTokens: number | null; fallbackReason?: string | null;
      averageSupport?: number | null; supportedClaimCount?: number; groundingValid?: boolean; policyValid?: boolean; terminationReason?: string;
    },
  ): AssistantExecutionResult {
    const asm = o.assembly;
    const answer = o.answer;

    // Resolve citations referenced by the answer for the display payload.
    const citeIds = new Set<string>([...(answer.citations ?? []), ...(answer.claims ?? []).flatMap((c) => c.citation_ids ?? [])]);
    const citations: AssistantExecutionResult['citations'] = [];
    for (const id of citeIds) { const r = resolveCitation(id); if (r) citations.push({ citationId: id, documentId: r.document.id, title: r.citation.title }); }
    const evidenceIds = [...new Set<string>([...(answer.evidence_ids ?? []), ...(answer.claims ?? []).flatMap((c) => c.evidence_ids ?? [])])];

    // Persist assistant message (sanitized, bounded plain text) + rich card json.
    const answerText = redactSecrets([answer.title, answer.summary].filter(Boolean).join(' — ')).slice(0, config.assistant.maxContextChars);
    const messageId = convRepo.addMessage(params.conversationId, 'assistant', answerText || answer.summary || '(no answer)', o.executionMode, correlationId);
    const llmIds = (db.prepare('SELECT id FROM llm_executions WHERE correlation_id = ?').all(correlationId) as { id: number }[]).map((r) => r.id);

    const cardJson = JSON.stringify(sanitizeCard({ ...answer, rich_content: (answer.rich_content ?? []).slice(0, config.assistant.maxRichContentItems) })).slice(0, config.assistant.maxContextChars);

    const executionId = repo.createAssistantExecution({
      correlation_id: correlationId, conversation_id: params.conversationId, message_id: messageId, user_id: params.userId,
      execution_mode: o.executionMode, status: o.status, intent: o.intent, capability: o.capability,
      provider: o.provider, model: o.model,
      iteration_count: asm?.iterationCount ?? 0, tool_call_count: asm?.toolCallCount ?? 0,
      retrieval_call_count: asm?.retrievalCallCount ?? 0, workflow_call_count: asm?.workflowCallCount ?? 0,
      planner_execution_id: asm?.plannerExecutionId ?? null, critic_execution_id: asm?.criticExecutionId ?? null,
      llm_execution_ids: llmIds, retrieval_execution_ids: asm?.retrievalExecutionIds ?? [],
      grounding_status: (o.groundingValid ?? true) ? 'GROUNDED' : 'INSUFFICIENT',
      citation_count: citations.length, evidence_count: evidenceIds.length, context_resolved: o.contextResolved,
      quality_gate: o.quality, average_grounding_support: o.averageSupport ?? null, latency_ms: Date.now() - started,
      input_tokens: o.inputTokens, output_tokens: o.outputTokens, answer_card_json: cardJson,
      fallback_reason: o.fallbackReason ?? null, failure_reason: o.status === 'FAILED' ? (o.terminationReason ?? 'FAILED') : null,
    });

    // Update conversation state (active entities + this turn's ordered citations).
    const nextContext: AssistantConversationContext = {
      ...o.context,
      citationIds: asm ? asm.citationOrder.slice(0, 20) : o.context.citationIds,
      evidenceIds: asm ? asm.evidenceIds.slice(0, 20) : o.context.evidenceIds,
      plannerExecutionId: asm?.plannerExecutionId ?? o.context.plannerExecutionId,
      criticExecutionId: asm?.criticExecutionId ?? o.context.criticExecutionId,
      topic: o.capability ?? o.context.topic,
      lastCapability: o.capability ?? o.context.lastCapability,
      lastExecutionMode: o.executionMode,
    };
    repo.upsertConversationContext(params.conversationId, nextContext);

    emitReady(events, sink);

    const diagnostics: AssistantExecutionResult['diagnostics'] = {
      intent: o.intent, capability: o.capability, iterationCount: asm?.iterationCount ?? 0, toolCallCount: asm?.toolCallCount ?? 0,
      retrievalCallCount: asm?.retrievalCallCount ?? 0, workflowCallCount: asm?.workflowCallCount ?? 0,
      claimCount: answer.claims.length, supportedClaimCount: o.supportedClaimCount ?? 0, citationCount: citations.length,
      evidenceCount: evidenceIds.length, groundingValid: o.groundingValid ?? true, policyValid: o.policyValid ?? true,
      averageGroundingSupport: o.averageSupport ?? null, contextResolved: o.contextResolved,
      terminationReason: o.terminationReason ?? 'DONE', qualityGate: o.quality,
    };

    return {
      conversationId: params.conversationId, messageId, correlationId, executionMode: o.executionMode, status: o.status,
      provider: o.provider, model: o.model, answer, citations, evidenceIds,
      workflowResults: asm?.workflowResults ?? [], toolActivity: asm?.toolActivity ?? [],
      richContent: (answer.rich_content ?? []), suggestedFollowups: answer.suggested_followups ?? [],
      context: nextContext, diagnostics, disclaimer: DISCLAIMER,
    };
  }
}

// --- helpers ---------------------------------------------------------------

function mapStepToAnswer(step: { title?: string; summary?: string; answer?: string; sections?: { heading: string; body: string }[]; claims?: { claim: string; citation_ids: string[]; evidence_ids: string[] }[]; citations?: string[]; evidence_ids?: string[]; workflow_references?: string[]; limitations?: string[]; suggested_followups?: string[] }): AssistantAnswer {
  return {
    answer_version: ANSWER_VERSION,
    title: String(step.title ?? 'Answer'),
    summary: String(step.summary ?? step.answer ?? ''),
    sections: Array.isArray(step.sections) ? step.sections.map((s) => ({ heading: String(s.heading ?? ''), body: String(s.body ?? '') })) : [],
    claims: Array.isArray(step.claims) ? step.claims.map((c) => ({ claim: String(c.claim ?? ''), citation_ids: c.citation_ids ?? [], evidence_ids: c.evidence_ids ?? [] })) : [],
    citations: step.citations ?? [],
    evidence_ids: step.evidence_ids ?? [],
    workflow_references: step.workflow_references ?? [],
    limitations: step.limitations ?? [],
    suggested_followups: step.suggested_followups ?? [],
    rich_content: [],
  };
}

function baseAnswer(title: string, summary: string, limitations: string[]): AssistantAnswer {
  return { answer_version: ANSWER_VERSION, title, summary, sections: [], claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations, suggested_followups: [], rich_content: [] };
}

function refusalAnswer(): AssistantAnswer {
  return baseAnswer(
    'Request not permitted',
    "I'm a read-only ORION assistant and cannot control satellites, run simulations, or approve/reject/resolve investigations, run SQL/shell commands, or fetch URLs. I can explain investigations, root causes, evidence, telemetry, alerts, reports, mission knowledge, and advisory Planner/Critic analyses.",
    ['Read-only: no mission-state changes, satellite control, or decisions are possible here.'],
  );
}
function unsupportedAnswer(): AssistantAnswer {
  return baseAnswer('Outside my scope', "I can help with ORION mission analysis — satellites, telemetry, alerts, investigations, evidence, reports, mission knowledge, similar incidents, and advisory Planner/Critic analyses. Could you rephrase your question in that scope?", ['Read-only advisory assistant.']);
}
const CAPABILITY_LINE = 'satellites, telemetry, alerts, investigations, root causes, evidence, reports, simulation status, historical incidents, and mission knowledge';
function greetingAnswer(): AssistantAnswer {
  return baseAnswer('Hello', `Hi! I'm the ORION AI Assistant. I can help you inspect ${CAPABILITY_LINE}. What would you like to check?`, []);
}
function thanksAnswer(): AssistantAnswer {
  return baseAnswer('You\'re welcome', `You're welcome. If you want, you can ask me about a satellite, telemetry, alerts, an investigation, evidence, reports, or mission procedures.`, []);
}
function capabilitiesAnswer(): AssistantAnswer {
  return baseAnswer('What I can do', `I'm the read-only ORION AI Assistant. I can help with ${CAPABILITY_LINE}. I answer from authoritative project data first and use mission documents only when a question genuinely needs them. I can't control satellites, run simulations, or approve/reject investigations.`, ['Read-only advisory assistant.']);
}
function outOfScopeAnswer(): AssistantAnswer {
  return baseAnswer('Outside my scope', `That question is outside my PROJECT ORION mission-assistance scope. I can help with ${CAPABILITY_LINE}.`, ['Read-only ORION mission assistant.']);
}
function satelliteNotFoundAnswer(candidate: string | null, registered: string[]): AssistantAnswer {
  const id = candidate ?? 'that satellite';
  const hint = registered.length ? ` Registered satellites include ${registered.join(', ')}.` : '';
  return baseAnswer(`Satellite ${id} not found`, `I couldn't find a registered satellite with ID ${id}.${hint}`, ['Resolved against the authoritative satellite registry; no mission documents were searched.']);
}
function conversationalFollowups(): string[] {
  return ['Show the status of a satellite.', 'What are the active alerts?', 'What does the mission manual say about communication loss?'];
}
function forbiddenAnswer(cap: string): AssistantAnswer {
  return baseAnswer('Not authorized', `Your role is not authorized to run the ${cap} capability.`, ['Access is governed by ORION RBAC.']);
}
function safeInsufficientAnswer(followups: string[]): AssistantAnswer {
  const a = baseAnswer('Insufficient evidence', 'I could not find sufficient grounded evidence to answer that safely.', ['Insufficient grounded evidence.']);
  a.suggested_followups = followups ?? [];
  return a;
}

function defaultFollowups(cap: string): string[] {
  switch (cap) {
    case 'INVESTIGATION_EXPLANATION': return ['Show me the evidence.', 'Have similar incidents happened before?', 'Run a deeper analysis.'];
    case 'PLANNER_ANALYSIS': return ['Critique that analysis.', 'What are the limitations of this analysis?', 'Show the evidence.'];
    case 'CRITIC_REVIEW': return ['Run a validated analysis.', 'What should the Mission Director review next?'];
    case 'SATELLITE_STATUS': return ['Why is it unhealthy?', 'Show the latest telemetry.', 'Are there any active alerts?'];
    default: return ['Why is a satellite unhealthy?', 'Show the evidence for a root cause.', 'What does the mission manual say?'];
  }
}

/** Strip anything that could carry raw payloads/secrets from the persisted card. */
function sanitizeCard(answer: AssistantAnswer): AssistantAnswer {
  return { ...answer, summary: redactSecrets(answer.summary).slice(0, 4000), title: redactSecrets(answer.title).slice(0, 300) };
}

function emitReady(events: AssistantEvent[], sink: AssistantEventSink | undefined): void {
  const ev = { type: 'ANSWER_READY' as const };
  events.push({ ...ev, seq: events.length });
  try { sink?.(ev); } catch { /* ignore */ }
}

export const assistantService = new AssistantService();
export { DISCLAIMER as ASSISTANT_DISCLAIMER };
