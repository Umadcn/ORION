/**
 * Bounded, timed, sanitized, audited tool executor (Phase 5).
 *
 * Every tool call: resolve against the allowlist (unknown → fail closed), RBAC
 * check, validate input schema, execute with a timeout, validate output schema,
 * bound + sanitize the output, and persist a `copilot_tool_executions` row.
 * Tools are read-only; there is no arbitrary code / SQL / URL / filesystem path.
 */
import { config, redactSecrets } from '../config.js';
import { validateJsonSchema } from '../llm/schema.js';
import { getTool } from './toolRegistry.js';
import { createToolExecution } from './copilotAuditRepository.js';
import type { ToolCall, ToolContext, ToolExecutionResult, ToolExecStatus, ToolValidationStatus } from './types.js';

function summarize(value: unknown, max: number): string {
  let s: string;
  try { s = typeof value === 'string' ? value : JSON.stringify(value); } catch { s = String(value); }
  s = redactSecrets(s);
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

async function withTimeout<T>(p: Promise<T> | T, ms: number): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_res, rej) => setTimeout(() => rej(new Error('TOOL_TIMEOUT')), ms)),
  ]);
}

export interface ToolAuditRef {
  correlationId: string;
  conversationId: string;
  messageId: number | null;
  executionMode: string;
}

/**
 * Optional executor overrides. Defaults preserve the exact Phase 5 behavior
 * (Copilot registry + copilot tool-timeout). The Phase 10 Assistant passes its
 * own registry resolver + tool timeout so it can reuse this executor unchanged
 * while adding its four read-only tools. Both audit to copilot_tool_executions.
 */
export interface ToolExecutorOptions {
  resolve?: (name: string) => import('./types.js').ToolDefinition | undefined;
  toolTimeoutMs?: number;
}

/** Execute a single tool call safely and audit it. Never throws. */
export async function executeToolCall(call: ToolCall, ctx: ToolContext, audit: ToolAuditRef, options: ToolExecutorOptions = {}): Promise<ToolExecutionResult> {
  const resolve = options.resolve ?? getTool;
  const timeoutCap = options.toolTimeoutMs ?? config.copilot.toolTimeoutMs;
  const started = Date.now();
  const toolCallId = String(call?.tool_call_id ?? 'tc');
  const toolName = String(call?.tool_name ?? '');
  const args = (call?.arguments && typeof call.arguments === 'object' ? call.arguments : {}) as Record<string, unknown>;
  const inputSummary = summarize(args, 400);

  const fail = (validationStatus: ToolValidationStatus, status: ToolExecStatus, code: string, message: string, version = 'n/a'): ToolExecutionResult => {
    const latencyMs = Date.now() - started;
    createToolExecution({
      correlation_id: audit.correlationId, conversation_id: audit.conversationId, message_id: audit.messageId,
      tool_call_id: toolCallId, tool_name: toolName || '(none)', tool_version: version, execution_mode: audit.executionMode,
      input_summary: inputSummary, output_summary: null, status, validation_status: validationStatus,
      latency_ms: latencyMs, error_code: code, sanitized_error: redactSecrets(message).slice(0, 300),
    });
    return { toolCallId, toolName, toolVersion: version, status, validationStatus, output: null, outputSummary: '', inputSummary, latencyMs, errorCode: code, sanitizedError: message };
  };

  // Fail closed on unknown tools.
  const tool = resolve(toolName);
  if (!tool) return fail('UNKNOWN_TOOL', 'REJECTED', 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`);

  // RBAC (if the tool restricts roles).
  if (tool.requiredRoles && !tool.requiredRoles.includes(ctx.role)) {
    return fail('FORBIDDEN', 'REJECTED', 'FORBIDDEN', `Role ${ctx.role} may not call ${tool.name}`, tool.version);
  }

  // Input schema validation.
  const inputCheck = validateJsonSchema(tool.inputSchema, args);
  if (!inputCheck.valid) return fail('INPUT_INVALID', 'REJECTED', 'INPUT_INVALID', inputCheck.errors.join('; '), tool.version);

  // Execute with a timeout.
  let output: unknown;
  try {
    output = await withTimeout(tool.execute(args, ctx), Math.min(tool.timeoutMs, timeoutCap));
  } catch (err) {
    const code = (err as Error).message === 'TOOL_TIMEOUT' ? 'TIMEOUT' : 'ERROR';
    return fail('VALID', 'ERROR', code, (err as Error).message, tool.version);
  }

  // Output schema validation.
  const outputCheck = validateJsonSchema(tool.outputSchema, output);
  if (!outputCheck.valid) return fail('OUTPUT_INVALID', 'ERROR', 'OUTPUT_INVALID', outputCheck.errors.join('; '), tool.version);

  const latencyMs = Date.now() - started;
  const outputSummary = summarize(output, tool.maxOutputChars);
  const grounding = tool.extractGrounding ? tool.extractGrounding(output) : {};

  createToolExecution({
    correlation_id: audit.correlationId, conversation_id: audit.conversationId, message_id: audit.messageId,
    tool_call_id: toolCallId, tool_name: tool.name, tool_version: tool.version, execution_mode: audit.executionMode,
    input_summary: inputSummary, output_summary: outputSummary.slice(0, 500), status: 'SUCCESS', validation_status: 'VALID',
    latency_ms: latencyMs, error_code: null, sanitized_error: null,
  });

  return {
    toolCallId, toolName: tool.name, toolVersion: tool.version, status: 'SUCCESS', validationStatus: 'VALID',
    output, outputSummary, inputSummary, latencyMs, errorCode: null, sanitizedError: null,
    citations: grounding.citations, retrievalExecutionId: grounding.retrievalExecutionId ?? null,
  };
}
