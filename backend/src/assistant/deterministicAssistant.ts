/**
 * ORION AI Assistant deterministic capability executor (Phase 10).
 *
 * For the selected capability this assembles the trusted grounding surface by
 * running the allowlisted read-only tools, iterative Agentic RAG (bounded), and
 * the read-only Planner/Critic/validated workflows — then composes a grounded,
 * cited deterministic AssistantAnswer + rich content. It is the offline path AND
 * the safety-net fallback for a rejected real-provider answer. It never claims to
 * be real model output (the service labels the execution mode). Prohibited
 * requests are refused upstream by the intent router.
 *
 * Reuses the Phase 5 grounding-context builder and tool executor (with the
 * assistant registry + assistant tool timeout). Every tool call is bounded and
 * audited. The deterministic RCA remains authoritative; mission state is never
 * mutated.
 */
import { db } from '../db.js';
import { config } from '../config.js';
import { tokenize } from '../retrieval/tokenize.js';
import { executeToolCall, type ToolAuditRef } from '../copilot/toolExecutor.js';
import { createGroundingContext, accumulate } from '../copilot/copilotContextBuilder.js';
import { getAssistantTool } from './assistantToolRegistry.js';
import { buildSourceReference } from './sourceInspection.js';
import { filterRelevant, type ScoredPassage } from './assistantRelevance.js';
import { extractSatelliteCandidates } from './intentRouter.js';
import { resolveSatelliteExact } from '../services/satelliteService.js';
import { AssistantWorkflowService, assistantWorkflowService } from './workflowService.js';
import type { CopilotGroundingContext, ToolCall, ToolContext, ToolExecutionResult } from '../copilot/types.js';
import type {
  AssistantAnswer, AssistantCapability, AssistantCitation, AssistantConversationContext,
  AssistantEvent, AssistantRichContent, AssistantToolResult, AssistantWorkflowResult,
} from './types.js';

const ANSWER_VERSION = 'orion-assistant-answer-v1';

const LIMITATIONS = [
  'Read-only advisory answer. The deterministic root-cause analysis is authoritative.',
  'Generated in deterministic mode — not real LLM output.',
];

export interface AssistantAssembly {
  grounding: CopilotGroundingContext;
  toolActivity: AssistantToolResult[];
  citations: AssistantCitation[];
  citationOrder: string[];
  evidenceIds: string[];
  workflowResults: AssistantWorkflowResult[];
  richContent: AssistantRichContent[];
  retrievalExecutionIds: number[];
  toolCallCount: number;
  retrievalCallCount: number;
  workflowCallCount: number;
  iterationCount: number;
  plannerExecutionId: number | null;
  criticExecutionId: number | null;
  /** The deterministic grounded answer draft. */
  answer: AssistantAnswer;
  insufficient: boolean;
}

export interface ExecuteParams {
  capability: AssistantCapability;
  message: string;
  context: AssistantConversationContext;
  inspectCitationId: string | null;
  execCtx: ToolContext;
  auditRef: ToolAuditRef;
  emit: (e: Omit<AssistantEvent, 'seq'>) => void;
}

export interface ExecutorDeps { workflowService?: AssistantWorkflowService }

let TC = 0;
function call(tool: string, args: Record<string, unknown>): ToolCall {
  return { tool_call_id: `atc${++TC}`, tool_name: tool, arguments: args };
}
function excerpt(text: string, n: number): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : flat.slice(0, n).replace(/\s\S*$/, '');
}

export type ToolRunner = (c: ToolCall, isRetrieval?: boolean) => Promise<ToolExecutionResult>;

/**
 * Build a bounded, audited tool runner that folds results into the shared
 * grounding/assembly and honors the capability's tool/retrieval budgets. Shared
 * by the deterministic plan AND the real-provider dynamic tool loop so both
 * accumulate into the SAME grounding surface and the SAME budget counters.
 */
export function createToolRunner(
  asm: AssistantAssembly, capability: AssistantCapability, execCtx: ToolContext,
  auditRef: ToolAuditRef, emit: (e: Omit<AssistantEvent, 'seq'>) => void,
): ToolRunner {
  return async (c: ToolCall, isRetrieval = false): Promise<ToolExecutionResult> => {
    if (asm.toolCallCount >= capability.maxToolCalls) return rejected(c, 'TOOL_CALL_LIMIT');
    if (isRetrieval && asm.retrievalCallCount >= capability.maxRetrievalCalls) return rejected(c, 'RETRIEVAL_CALL_LIMIT');
    asm.toolCallCount++;
    if (isRetrieval) { asm.retrievalCallCount++; emit({ type: 'RETRIEVAL_STARTED', detail: String(c.arguments.query ?? '').slice(0, 80) }); }
    else emit({ type: 'TOOL_STARTED', detail: c.tool_name });
    const res = await executeToolCall(c, execCtx, auditRef, { resolve: getAssistantTool, toolTimeoutMs: config.assistant.toolTimeoutMs });
    accumulate(asm.grounding, res);
    if (res.retrievalExecutionId) asm.retrievalExecutionIds.push(res.retrievalExecutionId);
    for (const cit of res.citations ?? []) {
      if (!asm.citationOrder.includes(cit.citationId)) {
        asm.citationOrder.push(cit.citationId);
        asm.citations.push({ citationId: cit.citationId, documentId: cit.documentId, title: cit.title });
      }
    }
    asm.toolActivity.push({ toolCallId: res.toolCallId, toolName: res.toolName, status: res.status, validationStatus: res.validationStatus, summary: res.outputSummary.slice(0, 160), latencyMs: res.latencyMs });
    emit({ type: isRetrieval ? 'RETRIEVAL_COMPLETED' : 'TOOL_COMPLETED', detail: `${res.toolName}:${res.status}` });
    return res;
  };
}

export class AssistantExecutor {
  private workflows: AssistantWorkflowService;
  constructor(deps: ExecutorDeps = {}) {
    this.workflows = deps.workflowService ?? assistantWorkflowService;
  }

  /** Create a fresh assembly seeded from the resolved conversation context. */
  newAssembly(context: AssistantConversationContext): AssistantAssembly {
    return {
      grounding: createGroundingContext(),
      toolActivity: [], citations: [], citationOrder: [], evidenceIds: [],
      workflowResults: [], richContent: [], retrievalExecutionIds: [],
      toolCallCount: 0, retrievalCallCount: 0, workflowCallCount: 0, iterationCount: 0,
      plannerExecutionId: context.plannerExecutionId, criticExecutionId: context.criticExecutionId,
      answer: emptyAnswer(), insufficient: false,
    };
  }

  /**
   * Phase 1: run the read-only workflows (Planner/Critic/validated) and source
   * inspection ONCE, folding their results into the shared grounding surface.
   * This runs regardless of provider so both the real-provider answer and the
   * deterministic answer explain the same advisory results.
   */
  async preExecute(p: ExecuteParams, asm: AssistantAssembly, runTool: ToolRunner): Promise<void> {
    for (const wf of p.capability.workflows) {
      if (asm.workflowCallCount >= config.assistant.maxWorkflowCalls) break;
      asm.workflowCallCount++;
      await this.runWorkflow(wf, p, asm, runTool);
    }
    if (p.capability.id === 'SOURCE_INSPECTION') {
      await this.buildSourceInspection(p, asm, runTool);
    }
  }

  /** Convenience: full deterministic path (offline + fallback). */
  async execute(p: ExecuteParams): Promise<AssistantAssembly> {
    const asm = this.newAssembly(p.context);
    const runTool = createToolRunner(asm, p.capability, p.execCtx, p.auditRef, p.emit);
    await this.preExecute(p, asm, runTool);
    await this.buildDeterministicPlan(p, asm, runTool);
    return asm;
  }

  private async runWorkflow(wf: string, p: ExecuteParams, asm: AssistantAssembly, _runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    const invId = p.context.investigationId;
    const plannerId = p.context.plannerExecutionId;
    if (wf === 'runPlannerAnalysis' || wf === 'runValidatedInvestigationAnalysis') {
      if (invId === null) { asm.insufficient = true; return; }
      p.emit({ type: 'PLANNER_STARTED', detail: `investigation ${invId}` });
      const outcome = wf === 'runValidatedInvestigationAnalysis'
        ? await this.workflows.runValidated({ investigationId: invId, userId: p.execCtx.userId, role: p.execCtx.role })
        : await this.workflows.runPlanner({ investigationId: invId, userId: p.execCtx.userId, role: p.execCtx.role });
      this.foldWorkflow(outcome, asm);
      p.emit({ type: 'PLANNER_COMPLETED', detail: outcome.result.executionMode });
      if (wf === 'runValidatedInvestigationAnalysis') p.emit({ type: 'CRITIC_COMPLETED', detail: outcome.result.criticDecision ?? 'N/A' });
    } else if (wf === 'runCriticReview') {
      if (plannerId === null) { asm.insufficient = true; return; }
      p.emit({ type: 'CRITIC_STARTED', detail: `planner ${plannerId}` });
      const outcome = await this.workflows.runCritic({ plannerExecutionId: plannerId, userId: p.execCtx.userId, role: p.execCtx.role });
      this.foldWorkflow(outcome, asm);
      p.emit({ type: 'CRITIC_COMPLETED', detail: outcome.result.criticDecision ?? outcome.result.executionMode });
    }
  }

  private foldWorkflow(outcome: import('./workflowService.js').WorkflowOutcome, asm: AssistantAssembly): void {
    asm.workflowResults.push(outcome.result);
    if (outcome.richContent) asm.richContent.push(outcome.richContent);
    if (outcome.plannerExecutionId !== null) asm.plannerExecutionId = outcome.plannerExecutionId;
    if (outcome.criticExecutionId !== null) asm.criticExecutionId = outcome.criticExecutionId;
    // Fold workflow citations + evidence + facts into the grounding surface.
    for (const c of outcome.citations) {
      asm.grounding.allowedCitationIds.add(c.citationId);
      if (!asm.citationOrder.includes(c.citationId)) { asm.citationOrder.push(c.citationId); asm.citations.push(c); }
    }
    for (const [id, text] of outcome.citationText) asm.grounding.citationText.set(id, text);
    for (const e of outcome.evidenceIds) { asm.grounding.allowedEvidenceIds.add(e); if (!asm.evidenceIds.includes(e)) asm.evidenceIds.push(e); }
    for (const f of outcome.factStrings) for (const t of tokenize(f, { maxTokens: 4096 })) { asm.grounding.toolFactTokens.add(t); for (const part of t.split(/[-_]/).filter(Boolean)) asm.grounding.toolFactTokens.add(part); }
  }

  private async buildSourceInspection(p: ExecuteParams, asm: AssistantAssembly, runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    const cid = p.inspectCitationId;
    if (!cid) { asm.insufficient = true; return; }
    await runTool(call('resolveCitation', { citationId: cid }));
    const ref = buildSourceReference(cid);
    if (ref) {
      asm.richContent.push({ type: 'KNOWLEDGE_SOURCE_LIST', data: { sources: [ref] } });
    } else {
      asm.insufficient = true;
    }
  }

  /** Phase 2: capability-specific deterministic tool plan + Agentic RAG + answer. */
  async buildDeterministicPlan(p: ExecuteParams, asm: AssistantAssembly, runTool: ToolRunner): Promise<void> {
    const cap = p.capability.id;
    const ctx = p.context;
    asm.iterationCount++;

    // Workflow / source capabilities: compose their answer from assembled data.
    if (cap === 'PLANNER_ANALYSIS' || cap === 'CRITIC_REVIEW' || cap === 'VALIDATED_INVESTIGATION_ANALYSIS') {
      asm.answer = this.workflowAnswer(cap, asm, ctx);
      return;
    }
    if (cap === 'SOURCE_INSPECTION') {
      asm.answer = this.sourceAnswer(asm, p.inspectCitationId);
      return;
    }

    switch (cap) {
      case 'SATELLITE_STATUS':
      case 'TELEMETRY_ANALYSIS':
        await this.satelliteOrTelemetry(cap, ctx, asm, runTool);
        return;
      case 'TELEMETRY_COMPARISON':
        await this.compareTelemetry(p, asm, runTool);
        return;
      case 'ALERT_ANALYSIS':
        await this.alerts(ctx, asm, runTool);
        return;
      case 'HISTORICAL_INCIDENT_SEARCH':
      case 'SIMILAR_INCIDENT_ANALYSIS':
        await this.historical(p, asm, runTool);
        return;
      case 'MISSION_KNOWLEDGE_SEARCH':
        await this.knowledge(p, asm, runTool);
        return;
      case 'EVIDENCE_EXPLANATION':
      case 'INVESTIGATION_EXPLANATION':
      case 'MISSION_QA':
      default:
        await this.investigationOrQa(cap, p, asm, runTool);
        return;
    }
  }

  // --- per-capability builders ----------------------------------------------

  private async satelliteOrTelemetry(cap: string, ctx: AssistantConversationContext, asm: AssistantAssembly, runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    if (!ctx.satelliteId) { asm.answer = clarificationAnswer(cap === 'TELEMETRY_ANALYSIS' ? 'Which satellite would you like telemetry for?' : 'Which satellite would you like the status of?'); asm.insufficient = true; return; }
    const sat = await runTool(call('getSatellite', { satelliteId: ctx.satelliteId }));
    const so = sat.output as { found?: boolean; id?: string; status?: string; status_mode?: string; derived_status?: string; manual_status_reason?: string | null } | null;
    const tel = await runTool(call('getTelemetry', { satelliteId: ctx.satelliteId, limit: 5 }));
    const to = tel.output as { latest?: { battery_percent: number; temperature_c: number; signal_strength_dbm: number; power_consumption_w: number } } | null;
    const claims: AssistantAnswer['claims'] = [];
    if (so?.found) {
      // Authoritative structured status — effective status, with honest manual-override wording.
      const eff = so.status ?? 'UNKNOWN';
      const statusClaim = so.status_mode === 'MANUAL'
        ? `${so.id} is currently in ${eff} status due to a manual operator override. Its system-derived status is ${so.derived_status ?? 'UNKNOWN'}.`
        : `${so.id} is currently ${eff} based on the system-derived mission state.`;
      claims.push({ claim: statusClaim, citation_ids: [], evidence_ids: [] });
    }
    if (to?.latest) {
      const l = to.latest;
      claims.push({ claim: `Latest telemetry for ${ctx.satelliteId}: battery ${l.battery_percent}%, temperature ${l.temperature_c} C, signal ${l.signal_strength_dbm} dBm, power ${l.power_consumption_w} W.`, citation_ids: [], evidence_ids: [] });
      asm.richContent.push({ type: cap === 'TELEMETRY_ANALYSIS' ? 'TELEMETRY_SUMMARY' : 'SATELLITE_STATUS_CARD', data: { satelliteId: ctx.satelliteId, status: so?.status ?? null, statusMode: so?.status_mode ?? null, derivedStatus: so?.derived_status ?? null, telemetry: l } });
    }
    if (claims.length === 0) { asm.answer = insufficientAnswer(`No status/telemetry is available for ${ctx.satelliteId}.`); asm.insufficient = true; return; }
    asm.answer = compose(`Status of ${ctx.satelliteId}`, claims.map((c) => c.claim).join(' '), claims);
  }

  private async alerts(ctx: AssistantConversationContext, asm: AssistantAssembly, runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    const r = await runTool(call('getAlerts', { ...(ctx.satelliteId ? { satelliteId: ctx.satelliteId } : {}) }));
    const out = r.output as { count?: number; alerts?: { anomaly_type: string; satellite_id: string; severity: string }[] } | null;
    const n = out?.count ?? 0;
    const list = (out?.alerts ?? []).slice(0, 8).map((a) => `${a.satellite_id} ${a.anomaly_type} (${a.severity})`);
    const scope = ctx.satelliteId ? ` for ${ctx.satelliteId}` : '';
    if (n === 0) { asm.answer = compose(`Alerts${scope}`, `There are no active alerts${scope}.`, []); return; }
    const claim = `There are ${n} alert(s)${scope}: ${list.join('; ')}.`;
    asm.richContent.push({ type: 'ALERT_SUMMARY', data: { satelliteId: ctx.satelliteId, count: n, alerts: list } });
    asm.answer = compose(`Alerts${scope}`, claim, [{ claim, citation_ids: [], evidence_ids: [] }]);
  }

  private async historical(p: ExecuteParams, asm: AssistantAssembly, runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    const ctx = p.context;
    const q = ctx.satelliteId ? `${ctx.satelliteId} ${p.message}` : p.message;
    const r = await runTool(call('searchHistoricalInvestigations', { query: q, ...(ctx.satelliteId ? { satelliteId: ctx.satelliteId } : {}), limit: 5 }));
    const out = r.output as { count?: number; results?: { investigation_id: number; root_cause: string; satellite_id: string }[] } | null;
    const results = out?.results ?? [];
    if (results.length === 0) { asm.answer = insufficientAnswer('No similar historical investigations were found.'); asm.insufficient = true; return; }
    const claims = results.slice(0, 5).map((h) => ({ claim: `Investigation ${h.investigation_id} on ${h.satellite_id} was attributed to ${String(h.root_cause).replace(/_/g, ' ').toLowerCase()}.`, citation_ids: [], evidence_ids: [] }));
    asm.richContent.push({ type: 'HISTORICAL_INCIDENT_LIST', data: { incidents: results.slice(0, 5).map((h) => ({ investigationId: h.investigation_id, satelliteId: h.satellite_id, rootCause: h.root_cause })) } });
    asm.answer = compose('Similar historical incidents', `Found ${results.length} similar historical investigation(s).`, claims);
  }

  /**
   * Bounded Agentic RAG with a deterministic relevance gate + abstention:
   * intent-aware query → retrieve → RELEVANCE FILTER (identifier-aware) → if none
   * ACCEPTED, refine once (bounded) → synthesize a concise answer from ACCEPTED
   * passages only. Rejected passages never become citations. No chunk-dumping.
   */
  private async knowledge(p: ExecuteParams, asm: AssistantAssembly, runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    const ctx = p.context;
    const gateQuery = ctx.satelliteId ? `${p.message} ${ctx.satelliteId}` : p.message;
    const seen = new Set<string>();
    let retrievalQuery = buildKnowledgeQuery(p.message, ctx.satelliteId);
    let accepted: ScoredPassage[] = [];
    for (let i = 0; i < Math.max(2, p.capability.maxRetrievalCalls); i++) {
      const norm = retrievalQuery.trim().toLowerCase();
      if (seen.has(norm)) break; // duplicate query — stop
      seen.add(norm);
      asm.iterationCount++;
      const r = await runTool(call('searchMissionKnowledge', { query: retrievalQuery, topK: 5 }), true);
      const out = r.output as { results?: { citation_id: string; title?: string; text: string }[] } | null;
      const results = (out?.results ?? []).map((c) => ({ citation_id: c.citation_id, title: c.title, text: c.text }));
      const gate = filterRelevant(gateQuery, results, { resolvedSatelliteId: ctx.satelliteId, allowIdentifierConflicts: !ctx.satelliteId });
      if (gate.accepted.length > 0) { accepted = gate.accepted; break; }
      // Refine only from a WEAK signal; otherwise stop and abstain.
      if (gate.weak.length === 0 && i > 0) break;
      retrievalQuery = `${retrievalQuery} procedure recommendation troubleshooting subsystem`;
    }
    if (accepted.length === 0) {
      asm.answer = insufficientAnswer("I couldn't find sufficiently relevant mission knowledge to answer that question.");
      asm.insufficient = true;
      return;
    }
    const top = accepted.slice(0, 3);
    const claims = top.map((c) => ({ claim: excerpt(c.text, 180), citation_ids: [c.citation_id], evidence_ids: [] }));
    asm.richContent.push({ type: 'KNOWLEDGE_SOURCE_LIST', data: { sources: top.map((c) => ({ citationId: c.citation_id, title: c.title ?? null, excerpt: excerpt(c.text, 200), relevance: 'ACCEPTED' })) } });
    const lead = `Based on ${top.length} relevant mission-knowledge passage${top.length === 1 ? '' : 's'}, here is what applies to your question.`;
    asm.answer = compose('Mission knowledge', lead, claims);
  }

  /** Deterministic telemetry comparison across the satellites named in the message. */
  private async compareTelemetry(p: ExecuteParams, asm: AssistantAssembly, runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    const candidates = extractSatelliteCandidates(p.message);
    const resolved = candidates.map((c) => resolveSatelliteExact(c)).filter((s): s is NonNullable<typeof s> => !!s);
    const missing = candidates.filter((c) => !resolveSatelliteExact(c));
    if (resolved.length < 2) {
      const detail = missing.length ? ` I couldn't find: ${missing.join(', ')}.` : '';
      asm.answer = insufficientAnswer(`I need two registered satellites to compare telemetry.${detail}`);
      asm.insufficient = true;
      return;
    }
    const rows: { id: string; latest: Record<string, number> | null }[] = [];
    for (const sat of resolved.slice(0, 2)) {
      const tel = await runTool(call('getTelemetry', { satelliteId: sat.id, limit: 1 }));
      const to = tel.output as { latest?: Record<string, number> } | null;
      rows.push({ id: sat.id, latest: to?.latest ?? null });
    }
    if (rows.some((r) => !r.latest)) {
      const none = rows.filter((r) => !r.latest).map((r) => r.id);
      asm.answer = insufficientAnswer(`No telemetry is available for ${none.join(', ')}, so I can't compare them yet.`);
      asm.insufficient = true;
      return;
    }
    const [a, b] = rows;
    const fields: [string, string, string][] = [
      ['battery', 'battery_percent', '%'], ['temperature', 'temperature_c', ' C'],
      ['signal', 'signal_strength_dbm', ' dBm'], ['power', 'power_consumption_w', ' W'],
    ];
    const claims = fields.map(([label, key, unit]) => ({
      claim: `${label}: ${a.id} ${a.latest![key]}${unit} vs ${b.id} ${b.latest![key]}${unit}.`,
      citation_ids: [], evidence_ids: [],
    }));
    asm.richContent.push({ type: 'TELEMETRY_SUMMARY', data: { comparison: true, satellites: [a.id, b.id], a: a.latest, b: b.latest } });
    asm.answer = compose(`Telemetry comparison — ${a.id} vs ${b.id}`, `Latest telemetry comparison for ${a.id} and ${b.id}.`, claims);
  }

  private async investigationOrQa(cap: string, p: ExecuteParams, asm: AssistantAssembly, runTool: (c: ToolCall, r?: boolean) => Promise<ToolExecutionResult>): Promise<void> {
    const ctx = p.context;
    let investigationId = ctx.investigationId;
    if (investigationId === null && ctx.satelliteId) {
      const inv = db.prepare('SELECT id FROM investigations WHERE satellite_id = ? ORDER BY id DESC LIMIT 1').get(ctx.satelliteId) as { id: number } | undefined;
      if (inv) investigationId = inv.id;
    }
    if (investigationId === null) {
      // Generic mission QA without an entity: try knowledge search.
      if (cap === 'MISSION_QA') { await this.knowledge(p, asm, runTool); return; }
      asm.answer = insufficientAnswer('Please specify a satellite (e.g. ORION-3) or an investigation (e.g. investigation 1).');
      asm.insufficient = true;
      return;
    }

    const invRes = await runTool(call('getInvestigation', { investigationId }));
    const inv = invRes.output as { found?: boolean; authoritative_root_cause?: string; satellite_id?: string; explanation?: string } | null;
    if (!inv?.found) { asm.answer = insufficientAnswer(`Investigation ${investigationId} was not found.`); asm.insufficient = true; return; }
    const rcLabel = (inv.authoritative_root_cause ?? 'UNKNOWN_ANOMALY').replace(/_/g, ' ').toLowerCase();
    const sat = inv.satellite_id ?? ctx.satelliteId ?? 'the satellite';

    const claims: AssistantAnswer['claims'] = [];
    claims.push({ claim: `The deterministic root cause for investigation ${investigationId} on ${sat} is ${rcLabel}.`, citation_ids: [], evidence_ids: [] });

    // Evidence.
    if (cap === 'EVIDENCE_EXPLANATION' || cap === 'INVESTIGATION_EXPLANATION') {
      const evRes = await runTool(call('getEvidence', { investigationId }));
      const evOut = evRes.output as { evidence?: { evidence_id: string; summary: string; supports_root_cause: boolean }[] } | null;
      const evItems = (evOut?.evidence ?? []).filter((e) => e.supports_root_cause).slice(0, 4);
      const evItemsAny = evItems.length ? evItems : (evOut?.evidence ?? []).slice(0, 4);
      for (const e of evItemsAny) claims.push({ claim: excerpt(e.summary, 160), citation_ids: [], evidence_ids: [e.evidence_id] });
      if (evItemsAny.length) asm.richContent.push({ type: 'EVIDENCE_LIST', data: { investigationId, evidence: evItemsAny.map((e) => ({ evidenceId: e.evidence_id, summary: excerpt(e.summary, 160), supportsRootCause: e.supports_root_cause })) } });
    }

    // Supporting knowledge (bounded RAG) — RELEVANCE-GATED. Only an ACCEPTED
    // passage about the resolved subsystem/RCA becomes a citation.
    const kRes = await runTool(call('searchMissionKnowledge', { query: `${rcLabel} troubleshooting recovery procedure`, topK: 4 }), true);
    const kOut = kRes.output as { results?: { citation_id: string; title?: string; text: string }[] } | null;
    const kGate = filterRelevant(rcLabel, (kOut?.results ?? []).map((c) => ({ citation_id: c.citation_id, title: c.title, text: c.text })), { allowIdentifierConflicts: true });
    const topCite = kGate.accepted[0];
    if (topCite) claims.push({ claim: excerpt(topCite.text, 180), citation_ids: [topCite.citation_id], evidence_ids: [] });

    asm.richContent.unshift({ type: 'INVESTIGATION_SUMMARY', data: { investigationId, satelliteId: sat, rootCause: inv.authoritative_root_cause ?? null, explanation: excerpt(inv.explanation ?? '', 300) } });
    asm.answer = compose(`Investigation ${investigationId}`, `${sat} is associated with ${rcLabel} (investigation ${investigationId}). ${excerpt(inv.explanation ?? '', 200)}`.trim(), claims);
  }

  // --- answer composers for workflow / source capabilities ------------------

  private workflowAnswer(cap: string, asm: AssistantAssembly, ctx: AssistantConversationContext): AssistantAnswer {
    const wf = asm.workflowResults[asm.workflowResults.length - 1];
    if (!wf) {
      const missing = cap === 'CRITIC_REVIEW'
        ? 'I need a completed Planner analysis to critique. Ask me to run an analysis first.'
        : 'I need an investigation with a completed root-cause analysis to analyze. Specify a satellite or investigation.';
      return insufficientAnswer(missing);
    }
    if (wf.status === 'FAILED') {
      return insufficientAnswer(`The ${wf.workflow.toLowerCase()} workflow could not complete: ${wf.summary}`);
    }
    const claims: AssistantAnswer['claims'] = [{ claim: wf.summary, citation_ids: [], evidence_ids: [] }];
    const title = cap === 'CRITIC_REVIEW' ? 'Critic review (advisory)' : cap === 'VALIDATED_INVESTIGATION_ANALYSIS' ? 'Validated analysis (advisory)' : 'Planner analysis (advisory)';
    const limitations = [
      'Advisory analysis-quality output only — NOT a mission decision. Human review is required.',
      'The deterministic root-cause analysis remains authoritative.',
      wf.executionMode === 'DETERMINISTIC_FALLBACK' ? 'Generated in deterministic mode — not real LLM output.' : '',
    ].filter(Boolean);
    const a = compose(title, wf.summary, claims);
    a.limitations = limitations;
    a.workflow_references = [wf.plannerExecutionId !== null ? `PLANNER:${wf.plannerExecutionId}` : '', wf.criticExecutionId !== null ? `CRITIC:${wf.criticExecutionId}` : ''].filter(Boolean);
    void ctx;
    return a;
  }

  private sourceAnswer(asm: AssistantAssembly, citationId: string | null): AssistantAnswer {
    const src = asm.richContent.find((r) => r.type === 'KNOWLEDGE_SOURCE_LIST');
    const ref = (src?.data.sources as { citationId?: string; documentTitle?: string; excerpt?: string }[] | undefined)?.[0];
    if (!ref || !citationId) return insufficientAnswer('I could not resolve that citation. Ask about a citation shown in a previous answer.');
    const a = compose(`Source ${citationId}`, `Citation ${citationId} is from "${ref.documentTitle ?? 'a mission document'}".`, [
      { claim: excerpt(ref.excerpt ?? '', 200), citation_ids: [citationId], evidence_ids: [] },
    ]);
    a.limitations = ['Read-only source inspection. Only the exact cited passage is shown.'];
    return a;
  }
}

// --- helpers ---------------------------------------------------------------

/** Build an intent-aware retrieval query: strip conversational filler, keep the
 *  mission subject, and preserve any resolved satellite id. */
function buildKnowledgeQuery(message: string, satelliteId: string | null): string {
  let q = String(message ?? '')
    .replace(/\b(what does the (mission\s+)?(manual|documentation|docs?|guide) say about|tell me about|according to the (manual|docs?)|what(?:'s| is| are)|how (do|should) (we|i)|please|can you|could you|do we have|is there)\b/gi, ' ')
    .replace(/[?!.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (q.length < 3) q = String(message ?? '').trim();
  return satelliteId ? `${q} ${satelliteId}` : q;
}

function emptyAnswer(): AssistantAnswer {
  return { answer_version: ANSWER_VERSION, title: '', summary: '', sections: [], claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: [], suggested_followups: [], rich_content: [] };
}

function compose(title: string, summary: string, claims: AssistantAnswer['claims']): AssistantAnswer {
  const citations = [...new Set(claims.flatMap((c) => c.citation_ids))];
  const evidence = [...new Set(claims.flatMap((c) => c.evidence_ids))];
  return {
    answer_version: ANSWER_VERSION, title, summary, sections: [], claims,
    citations, evidence_ids: evidence, workflow_references: [], limitations: LIMITATIONS, suggested_followups: [], rich_content: [],
  };
}

function insufficientAnswer(text: string): AssistantAnswer {
  return { answer_version: ANSWER_VERSION, title: 'Insufficient evidence', summary: text, sections: [], claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: LIMITATIONS, suggested_followups: [], rich_content: [] };
}

/** A clarification question (no retrieval, no fabricated selection). */
function clarificationAnswer(question: string): AssistantAnswer {
  return { answer_version: ANSWER_VERSION, title: 'Clarification needed', summary: question, sections: [], claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: ['I did not assume a satellite — please specify one.'], suggested_followups: [], rich_content: [] };
}

function rejected(c: ToolCall, code: string): ToolExecutionResult {
  return { toolCallId: String(c?.tool_call_id ?? 'tc'), toolName: String(c?.tool_name ?? ''), toolVersion: 'n/a', status: 'REJECTED', validationStatus: 'FORBIDDEN', output: null, outputSummary: '', inputSummary: '', latencyMs: 0, errorCode: code, sanitizedError: `${code} exhausted` };
}

export const assistantExecutor = new AssistantExecutor();
export { ANSWER_VERSION, LIMITATIONS };
