/**
 * ORION AI Assistant prompt construction (Phase 10).
 *
 * All prompts instruct strict, grounded, read-only behavior. The Assistant is
 * advisory: the deterministic RCA is authoritative; it cannot control
 * satellites, run simulations, or approve/reject/resolve anything. No hidden
 * chain-of-thought is requested or stored — only a short bounded reasoning
 * summary. Retrieval scores and grounding support are ranking signals, NEVER
 * confidence.
 */
import type { MessageRow } from '../copilot/types.js';
import type { AssistantConversationContext } from './types.js';
import type { ToolExecutionResult } from '../copilot/types.js';

export const ASSISTANT_VERSION = 'orion-assistant-v1';
export const ASSISTANT_INTENT_VERSION = 'orion-assistant-intent-v1';
export const ASSISTANT_SUMMARY_VERSION = 'orion-assistant-summary-v1';

export const ASSISTANT_SYSTEM_PROMPT = [
  'You are the ORION AI Assistant: a READ-ONLY, grounded, advisory mission assistant.',
  'You explain satellites, telemetry, alerts, investigations, evidence, reports, mission knowledge,',
  'historical incidents, and advisory Planner/Critic analyses. You NEVER control satellites, run',
  'simulations, or approve/reject/resolve investigations. The deterministic root-cause analysis is',
  'authoritative; retrieved documents are supporting context.',
  '',
  'RULES:',
  '- Every factual claim MUST be supported by a resolvable citation id, a valid in-context evidence id,',
  '  a deterministic tool fact, or a validated Planner/Critic result that is present in the provided context.',
  '- NEVER invent citation ids, evidence ids, satellite ids, or investigation ids.',
  '- If the evidence is insufficient, say so plainly. Do not fabricate.',
  '- Refuse operational/control/decision requests safely.',
  '- Retrieval similarity and grounding support are ranking signals, NOT confidence.',
  '- Respond ONLY with the required structured JSON. Keep reasoning_summary short (no hidden reasoning).',
].join('\n');

export const ASSISTANT_INTENT_SYSTEM_PROMPT = [
  'You are the ORION AI Assistant intent router. Classify the user message into exactly one allowlisted',
  'intent and extract any referenced entity ids (satellite id, investigation id, report id, citation id,',
  'or a citation ordinal like "the second citation"). Set references_previous=true when the message relies',
  'on prior conversation context ("it", "that investigation", "the evidence", "that analysis").',
  'Classify control/decision requests (reset, approve, reject, resolve, run SQL/shell, fetch a URL) as PROHIBITED.',
  'Classify anything outside the mission-analysis domain as UNSUPPORTED.',
  'Respond ONLY with the required structured JSON.',
].join('\n');

export const ASSISTANT_SUMMARY_SYSTEM_PROMPT = [
  'Summarize the following ORION assistant conversation into a short, factual, bounded summary that',
  'preserves the active satellite/investigation/report, key findings, and open questions. Do NOT include',
  'secrets, raw tool payloads, hidden reasoning, or fabricated ids. Respond ONLY with the required JSON.',
].join('\n');

function renderContext(ctx: AssistantConversationContext): string {
  const parts: string[] = [];
  if (ctx.satelliteId) parts.push(`activeSatellite=${ctx.satelliteId}`);
  if (ctx.investigationId) parts.push(`activeInvestigation=${ctx.investigationId}`);
  if (ctx.reportId) parts.push(`activeReport=${ctx.reportId}`);
  if (ctx.plannerExecutionId) parts.push(`activePlannerExecution=${ctx.plannerExecutionId}`);
  if (ctx.criticExecutionId) parts.push(`activeCriticExecution=${ctx.criticExecutionId}`);
  if (ctx.citationIds.length) parts.push(`previousCitations=[${ctx.citationIds.join(', ')}]`);
  if (ctx.topic) parts.push(`topic=${ctx.topic}`);
  return parts.length ? parts.join('; ') : '(none)';
}

function renderHistory(history: MessageRow[]): string {
  return history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
}

export function buildIntentUserPrompt(message: string, ctx: AssistantConversationContext, history: MessageRow[]): string {
  return [
    `CONVERSATION CONTEXT: ${renderContext(ctx)}`,
    history.length ? `RECENT MESSAGES:\n${renderHistory(history.slice(-4))}` : '',
    `USER MESSAGE: ${message}`,
  ].filter(Boolean).join('\n\n');
}

export function buildSummaryUserPrompt(history: MessageRow[]): string {
  return `CONVERSATION:\n${renderHistory(history)}`;
}

/**
 * Build the answer-generation prompt. It presents the assembled trusted context
 * (tool facts, resolvable citations with text, evidence ids, workflow summaries)
 * and forbids anything outside it.
 */
export function buildAssistantUserPrompt(params: {
  message: string;
  capabilityId: string;
  context: AssistantConversationContext;
  summary: string | null;
  history: MessageRow[];
  toolResults: ToolExecutionResult[];
  citations: { citationId: string; text: string }[];
  evidenceIds: string[];
  workflowSummaries: string[];
}): string {
  const cites = params.citations.length
    ? params.citations.map((c) => `- ${c.citationId}: ${c.text.slice(0, 400)}`).join('\n')
    : '(none)';
  const facts = params.toolResults.filter((t) => t.status === 'SUCCESS').map((t) => `- ${t.toolName}: ${t.outputSummary.slice(0, 400)}`).join('\n') || '(none)';
  const evid = params.evidenceIds.length ? params.evidenceIds.join(', ') : '(none)';
  const wf = params.workflowSummaries.length ? params.workflowSummaries.map((s) => `- ${s}`).join('\n') : '(none)';
  return [
    `CAPABILITY: ${params.capabilityId}`,
    `CONVERSATION CONTEXT: ${renderContext(params.context)}`,
    params.summary ? `CONVERSATION SUMMARY: ${params.summary}` : '',
    params.history.length ? `RECENT MESSAGES:\n${renderHistory(params.history.slice(-4))}` : '',
    `RESOLVABLE CITATIONS (only these may be cited):\n${cites}`,
    `ALLOWED EVIDENCE IDS (only these may be referenced): ${evid}`,
    `DETERMINISTIC TOOL FACTS:\n${facts}`,
    `WORKFLOW RESULTS (advisory; human review required):\n${wf}`,
    `USER MESSAGE: ${params.message}`,
    'Produce a grounded structured answer. Every claim must cite a citation id, an evidence id, or be supported by a tool fact above. Do not invent ids.',
  ].filter(Boolean).join('\n\n');
}
