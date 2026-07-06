/**
 * ORION AI Assistant API (Phase 10). Authenticated; conversations are per-user.
 *
 * READ-ONLY. The message endpoints accept ONLY the user message (bounded) plus
 * (for feedback) an allowlisted rating/reason/comment — NO provider/model/system-
 * prompt/tool/retrieval-mode/endpoint/URL/SQL/filesystem/capability overrides.
 * Evaluation + observability detail are Director/Admin only. Responses are
 * sanitized: no secrets, no raw prompts/responses, no hidden reasoning, no raw
 * vectors, no unrestricted tool payloads.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { requireRole, type AuthedRequest } from '../auth/middleware.js';
import { config, describeAssistantConfig, isRealLlmConfigured, isRealEmbeddingConfigured } from '../config.js';
import { parseRange } from '../observability/aggregation.js';
import { observabilityService } from '../observability/observabilityService.js';
import * as conv from '../copilot/conversationService.js';
import * as convRepo from '../copilot/conversationRepository.js';
import { assistantService } from '../assistant/assistantService.js';
import { listAssistantTools } from '../assistant/assistantToolRegistry.js';
import { listCapabilities } from '../assistant/capabilities.js';
import { buildSourceReference } from '../assistant/sourceInspection.js';
import { assistantEvaluationService } from '../assistant/assistantEvaluation.js';
import * as arepo from '../assistant/assistantRepository.js';
import type { AssistantEvent, AssistantFeedbackRating, AssistantFeedbackReason } from '../assistant/types.js';
import type { Role } from '../auth/users.js';

const router = Router();

function user(req: AuthedRequest): { id: string; role: Role } {
  return { id: req.user!.sub, role: req.user!.role as Role };
}

const FEEDBACK_REASONS = new Set<AssistantFeedbackReason>(['HELPFUL', 'CORRECT', 'WELL_GROUNDED', 'CLEAR', 'INCORRECT', 'UNSUPPORTED', 'MISSING_CONTEXT', 'BAD_CITATION', 'TOO_VERBOSE', 'OTHER']);

// GET /api/assistant/status — non-secret config + provider/embedding operating mode.
router.get('/status', (_req, res) => {
  res.json({
    read_only: true,
    config: describeAssistantConfig(),
    llm_operating_mode: isRealLlmConfigured() ? 'REAL_PROVIDER_CONFIGURED' : 'DETERMINISTIC_FALLBACK',
    embedding_operating_mode: isRealEmbeddingConfigured() ? 'REAL_EMBEDDING_PROVIDER' : 'LOCAL_HASH_FALLBACK',
    offline_mode: !isRealLlmConfigured(),
    tools: listAssistantTools().map((t) => ({ name: t.name, description: t.description, version: t.version })),
  });
});

// GET /api/assistant/capabilities — the allowlisted capability catalog.
router.get('/capabilities', (_req, res) => {
  res.json(listCapabilities().map((c) => ({
    id: c.id, description: c.description, tools: c.tools, workflows: c.workflows,
    retrieval_required: c.retrievalRequired, deterministic_rca_required: c.deterministicRcaRequired,
    required_roles: c.requiredRoles ?? null, max_tool_calls: c.maxToolCalls, max_retrieval_calls: c.maxRetrievalCalls,
    timeout_ms: c.timeoutMs, output_type: c.outputType, grounding_required: c.groundingRequired,
  })));
});

// POST /api/assistant/conversations — create a conversation.
router.post('/conversations', (req: AuthedRequest, res) => {
  const u = user(req);
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
  res.status(201).json(conv.createConversation(u.id, u.role, title));
});

// GET /api/assistant/conversations — list the caller's conversations.
router.get('/conversations', (req: AuthedRequest, res) => {
  res.json(conv.listConversations(user(req).id));
});

// GET /api/assistant/conversations/:id — conversation + messages (owner only), with rich cards.
router.get('/conversations/:id', asyncHandler((req: AuthedRequest, res) => {
  const u = user(req);
  const { conversation, messages } = conv.getConversationWithMessages(req.params.id, u.id);
  const enriched = messages.map((m) => {
    if (m.role !== 'assistant') return { ...m, card: null };
    const exec = arepo.getExecutionByMessageId(m.id);
    let card: unknown = null;
    if (exec && typeof exec.answer_card_json === 'string') { try { card = JSON.parse(exec.answer_card_json); } catch { card = null; } }
    return {
      ...m,
      execution_id: exec ? exec.id : null,
      status: exec ? exec.status : null,
      intent: exec ? exec.intent : null,
      capability: exec ? exec.capability : null,
      card,
    };
  });
  res.json({ conversation, messages: enriched });
}));

// GET /api/assistant/conversations/:id/messages — messages only (owner).
router.get('/conversations/:id/messages', asyncHandler((req: AuthedRequest, res) => {
  const { messages } = conv.getConversationWithMessages(req.params.id, user(req).id);
  res.json(messages);
}));

function validateMessage(req: AuthedRequest, res: import('express').Response): string | null {
  const message = req.body?.message;
  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'message is required' });
    return null;
  }
  if (message.length > config.assistant.maxMessageChars) {
    res.status(400).json({ error: 'BAD_REQUEST', message: `message exceeds ${config.assistant.maxMessageChars} characters` });
    return null;
  }
  return message;
}

// POST /api/assistant/conversations/:id/messages — ask (read-only, non-streaming).
router.post('/conversations/:id/messages', asyncHandler(async (req: AuthedRequest, res) => {
  const u = user(req);
  const message = validateMessage(req, res);
  if (message === null) return;
  const result = await assistantService.ask({ conversationId: req.params.id, userId: u.id, role: u.role, message });
  return res.json(result);
}));

// POST /api/assistant/conversations/:id/messages/stream — SSE staged execution events + final answer.
router.post('/conversations/:id/messages/stream', asyncHandler(async (req: AuthedRequest, res) => {
  const u = user(req);
  const message = validateMessage(req, res);
  if (message === null) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Track client disconnect via the RESPONSE 'close' (req 'close' can fire early
  // once the request body is consumed, which would truncate the stream).
  let clientGone = false;
  res.on('close', () => { if (!res.writableEnded) clientGone = true; });
  const send = (event: string, data: unknown) => { if (!clientGone && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

  const sink = (e: Omit<AssistantEvent, 'seq'>) => send('progress', e);
  try {
    const result = await assistantService.ask({ conversationId: req.params.id, userId: u.id, role: u.role, message }, sink);
    send('result', result);
  } catch (err) {
    send('error', { error: (err as Error).name === 'NotFoundError' ? 'NOT_FOUND' : 'ERROR', message: (err as Error).message });
  } finally {
    try { if (!clientGone && !res.writableEnded) res.write('event: done\ndata: {}\n\n'); } catch { /* ignore */ }
    try { if (!res.writableEnded) res.end(); } catch { /* ignore */ }
  }
}));

// POST /api/assistant/conversations/:id/archive — archive own conversation.
router.post('/conversations/:id/archive', asyncHandler((req: AuthedRequest, res) => {
  conv.archiveConversation(req.params.id, user(req).id);
  res.json({ ok: true });
}));

// GET /api/assistant/executions/:id — bounded execution metadata (owner only).
router.get('/executions/:id', asyncHandler((req: AuthedRequest, res) => {
  const u = user(req);
  const exec = arepo.getExecutionById(Math.floor(Number(req.params.id)));
  if (!exec || exec.user_id !== u.id) return res.status(404).json({ error: 'NOT_FOUND', message: 'Execution not found' });
  // Never expose llm_execution_ids raw payloads etc.; return sanitized metadata.
  return res.json({
    id: exec.id, conversationId: exec.conversation_id, messageId: exec.message_id, executionMode: exec.execution_mode,
    status: exec.status, intent: exec.intent, capability: exec.capability, provider: exec.provider, model: exec.model,
    iterationCount: exec.iteration_count, toolCallCount: exec.tool_call_count, retrievalCallCount: exec.retrieval_call_count,
    workflowCallCount: exec.workflow_call_count, plannerExecutionId: exec.planner_execution_id, criticExecutionId: exec.critic_execution_id,
    groundingStatus: exec.grounding_status, citationCount: exec.citation_count, evidenceCount: exec.evidence_count,
    qualityGate: exec.quality_gate, averageGroundingSupport: exec.average_grounding_support, latencyMs: exec.latency_ms,
    fallbackReason: exec.fallback_reason, createdAt: exec.created_at,
  });
}));

// GET /api/assistant/executions/:id/events — derived staged events for a completed turn (owner).
router.get('/executions/:id/events', asyncHandler((req: AuthedRequest, res) => {
  const u = user(req);
  const exec = arepo.getExecutionById(Math.floor(Number(req.params.id)));
  if (!exec || exec.user_id !== u.id) return res.status(404).json({ error: 'NOT_FOUND', message: 'Execution not found' });
  const events: { type: string; detail?: string; seq: number }[] = [];
  let seq = 0;
  events.push({ type: 'ASSISTANT_STARTED', seq: seq++ });
  events.push({ type: 'INTENT_CLASSIFIED', detail: String(exec.intent), seq: seq++ });
  events.push({ type: 'CONTEXT_RESOLVED', detail: Number(exec.context_resolved) === 1 ? 'resolved' : 'fresh', seq: seq++ });
  if (Number(exec.tool_call_count) > 0) events.push({ type: 'TOOL_COMPLETED', detail: `${exec.tool_call_count} tool call(s)`, seq: seq++ });
  if (exec.planner_execution_id) events.push({ type: 'PLANNER_COMPLETED', detail: `planner ${exec.planner_execution_id}`, seq: seq++ });
  if (exec.critic_execution_id) events.push({ type: 'CRITIC_COMPLETED', detail: `critic ${exec.critic_execution_id}`, seq: seq++ });
  events.push({ type: 'VALIDATING_ANSWER', detail: String(exec.quality_gate), seq: seq++ });
  events.push({ type: exec.status === 'FAILED' ? 'FAILED' : 'ANSWER_READY', detail: String(exec.execution_mode), seq: seq++ });
  return res.json({ executionId: exec.id, events });
}));

// GET /api/assistant/citations/:citationId — exact source inspection (owner-agnostic; read-only KB).
router.get('/citations/:citationId', asyncHandler((req: AuthedRequest, res) => {
  const ref = buildSourceReference(String(req.params.citationId));
  if (!ref) return res.status(404).json({ error: 'NOT_FOUND', message: 'Citation not found' });
  return res.json(ref);
}));

// POST /api/assistant/messages/:messageId/feedback — bounded feedback (own conversation only).
router.post('/messages/:messageId/feedback', asyncHandler((req: AuthedRequest, res) => {
  const u = user(req);
  const messageId = Math.floor(Number(req.params.messageId));
  // Resolve the message + its conversation to enforce ownership.
  const message = convRepo.getMessageById(messageId);
  if (!message) return res.status(404).json({ error: 'NOT_FOUND', message: 'Message not found' });
  conv.requireOwnedConversation(message.conversation_id, u.id); // throws 404 if not owner

  const rating = String(req.body?.rating ?? '') as AssistantFeedbackRating;
  if (rating !== 'THUMBS_UP' && rating !== 'THUMBS_DOWN') {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'rating must be THUMBS_UP or THUMBS_DOWN' });
  }
  let reason: AssistantFeedbackReason | null = null;
  if (req.body?.reason !== undefined && req.body?.reason !== null) {
    const r = String(req.body.reason) as AssistantFeedbackReason;
    if (!FEEDBACK_REASONS.has(r)) return res.status(400).json({ error: 'BAD_REQUEST', message: 'invalid reason' });
    reason = r;
  }
  const comment = reason === 'OTHER' && typeof req.body?.comment === 'string' ? req.body.comment : null;
  const exec = arepo.getExecutionByMessageId(messageId);
  const fb = arepo.createFeedback({
    user_id: u.id, conversation_id: message.conversation_id, message_id: messageId,
    execution_id: exec ? Number(exec.id) : null, rating, reason, comment,
  });
  return res.status(201).json(fb);
}));

// --- Director/Admin: evaluation + observability ---------------------------

router.post('/evaluations/run', requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = user(req);
  const maxScenarios = req.body?.maxScenarios !== undefined ? Math.floor(Number(req.body.maxScenarios)) : undefined;
  const summary = await assistantEvaluationService.run({ userId: u.id, role: u.role, maxScenarios });
  res.status(201).json(summary);
}));

router.get('/evaluations', requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'), (_req, res) => {
  res.json(assistantEvaluationService.listRuns());
});

router.get('/evaluations/:id', requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'), asyncHandler((req: AuthedRequest, res) => {
  const run = assistantEvaluationService.getRun(Math.floor(Number(req.params.id)));
  if (!run) return res.status(404).json({ error: 'NOT_FOUND', message: 'Evaluation run not found' });
  return res.json(run);
}));

router.get('/observability', requireRole('MISSION_DIRECTOR', 'SYSTEM_ADMIN'), (req: AuthedRequest, res) => {
  const range = parseRange((req.query as Record<string, string>).range, config.observability.defaultRange);
  res.json(observabilityService.buildSnapshot(range).assistant);
});

export default router;
