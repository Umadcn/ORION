/**
 * Mission Copilot orchestration (Phase 5).
 *
 * READ-ONLY. Uses LlmRunner ONLY (no direct provider calls). Bounded tool-calling
 * loop with a hard iteration/tool-call/time budget. Real-provider output and the
 * deterministic fallback pass through the SAME validators; deterministic output
 * is never labeled real. Every tool call and every message execution is audited.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config, isRealLlmConfigured, redactSecrets } from '../config.js';
import { LlmRunner, llmRunner } from '../llm/runner.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import { COPILOT_STEP_SCHEMA, COPILOT_STEP_SCHEMA_NAME } from './schemas.js';
import { COPILOT_PROMPT_VERSION, COPILOT_SYSTEM_PROMPT, buildCopilotUserPrompt } from './prompt.js';
import { executeToolCall, type ToolAuditRef } from './toolExecutor.js';
import { accumulate, createGroundingContext } from './copilotContextBuilder.js';
import { validateCopilotAnswer } from './copilotValidators.js';
import { planDeterministicAnswer } from './deterministicCopilotFallback.js';
import { createCopilotExecution } from './copilotAuditRepository.js';
import * as convRepo from './conversationRepository.js';
import { requireOwnedConversation } from './conversationService.js';
import type {
  CopilotClaim, CopilotFinalAnswer, CopilotResult, CopilotStep, ToolActivity, ToolCall, ToolContext, ToolExecutionResult,
} from './types.js';
import type { Role } from '../auth/users.js';

export class CopilotValidationError extends Error {}

const DISCLAIMER =
  'Read-only Mission Copilot. The deterministic root-cause analysis is authoritative; ' +
  'retrieved documents are supporting context. Grounding support and retrieval scores are not confidence. ' +
  'DETERMINISTIC_FALLBACK answers are not real LLM output.';

export interface CopilotDeps {
  runner?: LlmRunner;
  realProviderAvailable?: boolean;
}

export class CopilotService {
  private runner: LlmRunner;
  private realAvailable: boolean;
  constructor(deps: CopilotDeps = {}) {
    this.runner = deps.runner ?? llmRunner;
    this.realAvailable = deps.realProviderAvailable ?? isRealLlmConfigured();
  }

  async ask(params: { conversationId: string; userId: string; role: Role; message: string }): Promise<CopilotResult> {
    const started = Date.now();
    const correlationId = crypto.randomUUID();
    requireOwnedConversation(params.conversationId, params.userId); // throws NotFound (404) if not owned

    const rawMessage = String(params.message ?? '');
    if (rawMessage.trim().length === 0) throw new CopilotValidationError('message is required');
    if (rawMessage.length > config.copilot.maxMessageChars) throw new CopilotValidationError(`message exceeds ${config.copilot.maxMessageChars} chars`);
    const message = rawMessage;

    convRepo.addMessage(params.conversationId, 'user', message.slice(0, config.copilot.maxMessageChars), null, correlationId);

    const execCtx: ToolContext = { userId: params.userId, role: params.role, correlationId };
    const auditRef: ToolAuditRef = { correlationId, conversationId: params.conversationId, messageId: null, executionMode: this.realAvailable ? 'REAL_PROVIDER' : 'DETERMINISTIC_FALLBACK' };
    const ctx = createGroundingContext();
    const toolResults: ToolExecutionResult[] = [];
    const toolActivity: ToolActivity[] = [];
    const retrievalIds: number[] = [];
    let toolCallCount = 0;
    let iterationCount = 0;

    const runTool = async (call: ToolCall): Promise<ToolExecutionResult> => {
      if (toolCallCount >= config.copilot.maxToolCalls) {
        return { toolCallId: String(call?.tool_call_id ?? 'tc'), toolName: String(call?.tool_name ?? ''), toolVersion: 'n/a', status: 'REJECTED', validationStatus: 'FORBIDDEN', output: null, outputSummary: '', inputSummary: '', latencyMs: 0, errorCode: 'TOOL_CALL_LIMIT', sanitizedError: 'tool-call budget exhausted' };
      }
      toolCallCount++;
      const res = await executeToolCall(call, execCtx, auditRef);
      accumulate(ctx, res);
      toolResults.push(res);
      if (res.retrievalExecutionId) retrievalIds.push(res.retrievalExecutionId);
      toolActivity.push({ toolName: res.toolName, status: res.status, validationStatus: res.validationStatus, summary: res.outputSummary.slice(0, 160) });
      return res;
    };

    let candidate: CopilotFinalAnswer | null = null;
    let source: 'REAL' | 'FALLBACK' = 'FALLBACK';
    let terminationReason = 'FINAL_ANSWER';
    let insufficient = false;
    let providerName: string | null = null;
    let providerModel: string | null = null;

    if (this.realAvailable) {
      const history = convRepo.getContextMessages(params.conversationId);
      const loop = await this.realProviderLoop(message, history, ctx, execCtx, runTool, () => Date.now() - started, () => toolCallCount, () => { iterationCount++; return iterationCount; });
      candidate = loop.finalAnswer;
      terminationReason = loop.terminationReason;
      providerName = loop.provider;
      providerModel = loop.model;
      if (candidate) source = 'REAL';
    }

    // Validate real output; degrade to deterministic fallback if missing/invalid.
    let validation = candidate ? validateCopilotAnswer(candidate, ctx) : null;
    let fallbackReason: string | null = null;
    const realOk = validation ? validation.citationValid && validation.evidenceValid && validation.groundingValid && validation.policyValid : false;

    if (!candidate || (source === 'REAL' && !realOk)) {
      if (candidate && !realOk) fallbackReason = 'REAL_REJECTED';
      const plan = await planDeterministicAnswer(message, runTool, ctx);
      candidate = plan.answer;
      insufficient = plan.insufficient;
      source = 'FALLBACK';
      validation = validateCopilotAnswer(candidate, ctx);
    }

    const executionMode = source === 'REAL' ? 'REAL_PROVIDER' : 'DETERMINISTIC_FALLBACK';
    const groundingOk = validation!.citationValid && validation!.evidenceValid && validation!.groundingValid && validation!.policyValid;

    let status: CopilotResult['status'];
    if (source === 'REAL' && groundingOk) status = 'REAL_PROVIDER';
    else if (insufficient) status = 'INSUFFICIENT_EVIDENCE';
    else if (groundingOk) status = 'DETERMINISTIC_FALLBACK';
    else {
      // Safety net: even the deterministic answer failed validation -> return a
      // safe insufficient-evidence response with no factual claims.
      status = 'INSUFFICIENT_EVIDENCE';
      candidate = { type: 'FINAL_ANSWER', answer: 'I could not find sufficient grounded evidence to answer that safely.', claims: [], citations: [], evidence_ids: [], limitations: ['Insufficient grounded evidence.'], suggested_followups: candidate!.suggested_followups ?? [] };
      validation = validateCopilotAnswer(candidate, ctx);
    }

    // Resolve citations for the response payload.
    const citeIds = new Set<string>([...(candidate!.citations ?? []), ...(candidate!.claims ?? []).flatMap((c) => c.citation_ids ?? [])]);
    const citations: CopilotResult['citations'] = [];
    for (const id of citeIds) {
      const r = resolveCitation(id);
      if (r) citations.push({ citationId: id, documentId: r.document.id, title: r.citation.title });
    }
    const evidenceIds = [...new Set<string>([...(candidate!.evidence_ids ?? []), ...(candidate!.claims ?? []).flatMap((c) => c.evidence_ids ?? [])])];

    // Persist assistant message + audit.
    const answerText = redactSecrets(candidate!.answer).slice(0, config.copilot.maxContextChars);
    const messageId = convRepo.addMessage(params.conversationId, 'assistant', answerText, executionMode, correlationId);
    const llmIds = (db.prepare('SELECT id FROM llm_executions WHERE correlation_id = ?').all(correlationId) as { id: number }[]).map((r) => r.id);

    createCopilotExecution({
      correlation_id: correlationId, conversation_id: params.conversationId, message_id: messageId, user_id: params.userId,
      execution_mode: executionMode, provider: providerName, model: providerModel, iteration_count: iterationCount,
      tool_call_count: toolCallCount, retrieval_execution_ids: retrievalIds, llm_execution_ids: llmIds,
      generation_status: status, grounding_status: groundingOk ? 'GROUNDED' : 'INSUFFICIENT',
      citation_count: citations.length, evidence_count: evidenceIds.length, latency_ms: Date.now() - started,
      fallback_reason: fallbackReason, failure_reason: null,
    });

    const supportedClaimCount = validation!.claims.filter((c) => c.supported).length;
    const claims: CopilotClaim[] = (candidate!.claims ?? []).map((c) => ({ claim: c.claim, citation_ids: c.citation_ids ?? [], evidence_ids: c.evidence_ids ?? [] }));

    return {
      conversationId: params.conversationId, messageId, correlationId, executionMode, status,
      provider: providerName, model: providerModel, answer: answerText, claims, citations, evidenceIds,
      limitations: candidate!.limitations ?? [], suggestedFollowups: (candidate!.suggested_followups ?? []).slice(0, config.copilot.maxSuggestedFollowups),
      toolActivity,
      diagnostics: {
        iterationCount, toolCallCount, claimCount: claims.length, supportedClaimCount,
        citationCount: citations.length, evidenceCount: evidenceIds.length, groundingValid: groundingOk,
        policyValid: validation!.policyValid, averageGroundingSupport: validation!.averageSupport, terminationReason,
      },
      disclaimer: DISCLAIMER,
    };
  }

  /** Bounded real-provider tool-calling loop via LlmRunner. */
  private async realProviderLoop(
    message: string, history: import('./types.js').MessageRow[], ctx: import('./types.js').CopilotGroundingContext,
    _execCtx: ToolContext, runTool: (c: ToolCall) => Promise<ToolExecutionResult>,
    elapsed: () => number, toolCalls: () => number, nextIteration: () => number,
  ): Promise<{ finalAnswer: CopilotFinalAnswer | null; terminationReason: string; provider: string | null; model: string | null }> {
    const toolResults: ToolExecutionResult[] = [];
    let provider: string | null = null;
    let model: string | null = null;

    for (let i = 0; i < config.copilot.maxIterations; i++) {
      if (elapsed() > config.copilot.maxExecutionMs) return { finalAnswer: null, terminationReason: 'TIMEOUT', provider, model };
      if (toolCalls() >= config.copilot.maxToolCalls) return { finalAnswer: null, terminationReason: 'TOOL_CALL_LIMIT', provider, model };
      nextIteration();

      const userPrompt = buildCopilotUserPrompt(message, history, toolResults, ctx);
      const response = await this.runner.run<CopilotStep>({
        requestType: 'copilot-step', promptVersion: COPILOT_PROMPT_VERSION,
        messages: [{ role: 'system', content: COPILOT_SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
        structuredOutput: { name: COPILOT_STEP_SCHEMA_NAME, schema: COPILOT_STEP_SCHEMA },
      });
      provider = response.provider; model = response.model;
      if (response.executionMode !== 'REAL_PROVIDER' || !response.structured) {
        return { finalAnswer: null, terminationReason: 'NO_REAL_PROVIDER', provider, model };
      }
      const step = response.structured;
      if (step.type === 'FINAL_ANSWER') {
        return { finalAnswer: normalizeFinalAnswer(step), terminationReason: 'FINAL_ANSWER', provider, model };
      }
      if (step.type === 'TOOL_REQUEST' && Array.isArray(step.tool_calls)) {
        for (const call of step.tool_calls) {
          if (toolCalls() >= config.copilot.maxToolCalls) break;
          const res = await runTool(call);
          toolResults.push(res);
        }
        continue;
      }
      return { finalAnswer: null, terminationReason: 'INVALID_STEP', provider, model };
    }
    return { finalAnswer: null, terminationReason: 'ITERATION_LIMIT', provider, model };
  }
}

function normalizeFinalAnswer(step: Extract<CopilotStep, { type: 'FINAL_ANSWER' }>): CopilotFinalAnswer {
  return {
    type: 'FINAL_ANSWER',
    answer: String(step.answer ?? ''),
    claims: Array.isArray(step.claims) ? step.claims.map((c) => ({ claim: String(c.claim ?? ''), citation_ids: c.citation_ids ?? [], evidence_ids: c.evidence_ids ?? [] })) : [],
    citations: step.citations ?? [],
    evidence_ids: step.evidence_ids ?? [],
    limitations: step.limitations ?? [],
    suggested_followups: step.suggested_followups ?? [],
  };
}

export const copilotService = new CopilotService();
