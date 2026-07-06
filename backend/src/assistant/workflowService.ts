/**
 * ORION AI Assistant workflow service (Phase 10).
 *
 * Read-only invocation of the EXISTING Phase 6 Planner and Phase 7 Critic
 * services from chat — plus a validated Planner → Critic workflow. It does NOT
 * duplicate Planner/Critic logic; it calls their services. Mission state is
 * never mutated; the deterministic RCA is preserved exactly. Planner output is
 * advisory only; Critic ACCEPT/REVISE/REJECT is analysis-quality review only
 * (NEVER a mission approval/rejection/resolution). humanReviewRequired is
 * preserved. Failures are isolated and returned honestly (never faked).
 */
import { plannerService as defaultPlanner, PlannerService } from '../planner/plannerService.js';
import { criticService as defaultCritic, CriticService } from '../critic/criticService.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import type { Role } from '../auth/users.js';
import type { AssistantCitation, AssistantRichContent, AssistantWorkflowResult } from './types.js';

export interface WorkflowDeps {
  plannerService?: PlannerService;
  criticService?: CriticService;
}

export interface WorkflowOutcome {
  result: AssistantWorkflowResult;
  citations: AssistantCitation[];
  /** citationId -> excerpt text, for lexical grounding of the conversational answer. */
  citationText: Map<string, string>;
  evidenceIds: string[];
  /** Trusted fact strings surfaced by the workflow (ground the answer as workflow facts). */
  factStrings: string[];
  richContent: AssistantRichContent | null;
  plannerExecutionId: number | null;
  criticExecutionId: number | null;
}

export class AssistantWorkflowService {
  private planner: PlannerService;
  private critic: CriticService;
  constructor(deps: WorkflowDeps = {}) {
    this.planner = deps.plannerService ?? defaultPlanner;
    this.critic = deps.criticService ?? defaultCritic;
  }

  private citationsFor(cites: { citationId: string }[]): { citations: AssistantCitation[]; text: Map<string, string> } {
    const citations: AssistantCitation[] = [];
    const text = new Map<string, string>();
    for (const c of cites) {
      const r = resolveCitation(c.citationId);
      if (r) {
        citations.push({ citationId: c.citationId, documentId: r.document.id, title: r.citation.title });
        text.set(c.citationId, r.chunk.content ?? '');
      }
    }
    return { citations, text };
  }

  /** Run an advisory Planner analysis for an investigation. Never throws. */
  async runPlanner(params: { investigationId: number; userId: string; role: Role }): Promise<WorkflowOutcome> {
    try {
      const res = await this.planner.analyze({ investigationId: params.investigationId, userId: params.userId, role: params.role });
      const { citations, text } = this.citationsFor(res.citations);
      const facts: string[] = [];
      if (res.analysis) {
        facts.push(res.analysis.analysis_summary);
        for (const f of res.analysis.findings) facts.push(f.claim);
      }
      const rich: AssistantRichContent = {
        type: 'PLANNER_ANALYSIS_CARD',
        data: {
          plannerExecutionId: res.plannerExecutionId,
          investigationId: res.investigationId,
          executionMode: res.executionMode,
          planStatus: res.planStatus,
          title: res.analysis?.title ?? 'Investigation analysis',
          summary: (res.analysis?.analysis_summary ?? '').slice(0, 600),
          findings: (res.analysis?.findings ?? []).slice(0, 6).map((f) => ({ claim: f.claim.slice(0, 240), citation_ids: f.citation_ids, evidence_ids: f.evidence_ids })),
          knowledgeGaps: (res.analysis?.knowledge_gaps ?? []).slice(0, 6),
          limitations: (res.analysis?.limitations ?? []).slice(0, 6),
          advisoryLabel: res.advisoryLabel,
        },
      };
      return {
        result: {
          workflow: 'PLANNER', status: 'SUCCESS', executionMode: res.executionMode,
          investigationId: res.investigationId, plannerExecutionId: res.plannerExecutionId, criticExecutionId: null,
          advisoryLabel: res.advisoryLabel, humanReviewRequired: true,
          summary: `Planner analysis (${res.executionMode}) for investigation ${res.investigationId}: ${(res.analysis?.analysis_summary ?? '').slice(0, 200)}`,
        },
        citations, citationText: text, evidenceIds: res.evidenceIds, factStrings: facts,
        richContent: rich, plannerExecutionId: res.plannerExecutionId, criticExecutionId: null,
      };
    } catch (err) {
      return this.failure('PLANNER', params.investigationId, null, null, (err as Error).message);
    }
  }

  /** Run an advisory Critic review of a Planner execution. Never throws. */
  async runCritic(params: { plannerExecutionId: number; userId: string; role: Role }): Promise<WorkflowOutcome> {
    try {
      const res = await this.critic.review({ plannerExecutionId: params.plannerExecutionId, userId: params.userId, role: params.role });
      const facts: string[] = [res.review.summary, ...res.review.issues.map((i) => i.description ?? '')].filter(Boolean);
      const rich: AssistantRichContent = {
        type: 'CRITIC_REVIEW_CARD',
        data: {
          criticExecutionId: res.criticExecutionId,
          plannerExecutionId: res.plannerExecutionId,
          investigationId: res.investigationId,
          executionMode: res.executionMode,
          criticStatus: res.criticStatus,
          initialDecision: res.initialDecision,
          finalDecision: res.finalDecision,
          summary: (res.review.summary ?? '').slice(0, 600),
          issues: res.review.issues.slice(0, 6).map((i) => ({ severity: i.severity, description: (i.description ?? '').slice(0, 200) })),
          contradictionCount: res.contradictions.length,
          revisionAttemptCount: res.revisionAttempts.length,
          humanReviewRequired: true,
          advisoryLabel: res.advisoryLabel,
        },
      };
      return {
        result: {
          workflow: 'CRITIC', status: 'SUCCESS', executionMode: res.executionMode,
          investigationId: res.investigationId, plannerExecutionId: res.plannerExecutionId, criticExecutionId: res.criticExecutionId,
          advisoryLabel: res.advisoryLabel, criticDecision: res.finalDecision, humanReviewRequired: true,
          summary: `Critic review (${res.executionMode}): analysis-quality decision ${res.finalDecision}. Human review required. This is NOT a mission approval/rejection.`,
        },
        citations: [], citationText: new Map(), evidenceIds: [], factStrings: facts,
        richContent: rich, plannerExecutionId: res.plannerExecutionId, criticExecutionId: res.criticExecutionId,
      };
    } catch (err) {
      return this.failure('CRITIC', null, params.plannerExecutionId, null, (err as Error).message);
    }
  }

  /** Validated Planner → Critic workflow. Planner first; Critic reviews its output. Never throws. */
  async runValidated(params: { investigationId: number; userId: string; role: Role }): Promise<WorkflowOutcome> {
    const planner = await this.runPlanner(params);
    if (planner.result.status === 'FAILED' || planner.plannerExecutionId === null) {
      return { ...planner, result: { ...planner.result, workflow: 'VALIDATED_ANALYSIS' } };
    }
    const critic = await this.runCritic({ plannerExecutionId: planner.plannerExecutionId, userId: params.userId, role: params.role });

    const criticData = critic.richContent?.data ?? {};
    const rich: AssistantRichContent = {
      type: 'VALIDATED_ANALYSIS_CARD',
      data: {
        investigationId: params.investigationId,
        plannerExecutionId: planner.plannerExecutionId,
        criticExecutionId: critic.criticExecutionId,
        plannerExecutionMode: planner.result.executionMode,
        criticExecutionMode: critic.result.executionMode,
        criticDecision: critic.result.criticDecision ?? null,
        planner: planner.richContent?.data ?? {},
        critic: criticData,
        humanReviewRequired: true,
        advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY',
      },
    };
    const status: 'SUCCESS' | 'FAILED' = critic.result.status === 'FAILED' ? 'FAILED' : 'SUCCESS';
    return {
      result: {
        workflow: 'VALIDATED_ANALYSIS', status, executionMode: planner.result.executionMode,
        investigationId: params.investigationId, plannerExecutionId: planner.plannerExecutionId, criticExecutionId: critic.criticExecutionId,
        advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY', criticDecision: critic.result.criticDecision ?? null, humanReviewRequired: true,
        summary: `Validated analysis: Planner (${planner.result.executionMode}) reviewed by Critic (${critic.result.executionMode}) → ${critic.result.criticDecision ?? 'N/A'}. Advisory only; human review required.`,
      },
      citations: planner.citations, citationText: planner.citationText,
      evidenceIds: planner.evidenceIds, factStrings: [...planner.factStrings, ...critic.factStrings],
      richContent: rich, plannerExecutionId: planner.plannerExecutionId, criticExecutionId: critic.criticExecutionId,
    };
  }

  private failure(workflow: AssistantWorkflowResult['workflow'], investigationId: number | null, plannerExecutionId: number | null, criticExecutionId: number | null, reason: string): WorkflowOutcome {
    return {
      result: {
        workflow, status: 'FAILED', executionMode: 'FAILED',
        investigationId, plannerExecutionId, criticExecutionId,
        advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY', humanReviewRequired: true,
        summary: `${workflow} workflow could not complete: ${reason.slice(0, 160)}`,
      },
      citations: [], citationText: new Map(), evidenceIds: [], factStrings: [],
      richContent: null, plannerExecutionId, criticExecutionId,
    };
  }
}

export const assistantWorkflowService = new AssistantWorkflowService();
