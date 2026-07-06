/**
 * Pure presentation helpers for the ORION AI Assistant (Phase 10).
 *
 * These guarantee honest labeling in the UI: deterministic fallback is NEVER
 * shown as "real AI", LocalHash embeddings are never shown as real semantic
 * execution, and grounding/retrieval signals are never called "confidence".
 * Kept pure + dependency-free so they are unit-tested without a DOM.
 */
import type { AssistantExecutionMode, AssistantExecutionStatus } from '../api/client';

export interface Badge { label: string; text: string; bg: string }

/** Execution-mode badge. Fallback / insufficient / failed are never "real AI". */
export function executionModeBadge(mode: AssistantExecutionMode | string): Badge {
  switch (mode) {
    case 'REAL_PROVIDER':
      return { label: 'Real provider', text: 'text-accent-green', bg: 'bg-accent-green/15' };
    case 'DETERMINISTIC_FALLBACK':
      return { label: 'Deterministic fallback', text: 'text-accent-cyan', bg: 'bg-accent-cyan/15' };
    case 'INSUFFICIENT_EVIDENCE':
      return { label: 'Insufficient evidence', text: 'text-accent-orange', bg: 'bg-accent-orange/15' };
    case 'FAILED':
      return { label: 'Failed', text: 'text-accent-red', bg: 'bg-accent-red/15' };
    default:
      return { label: 'Unknown', text: 'text-slate-400', bg: 'bg-space-700' };
  }
}

/** True ONLY when the answer is a genuine, accepted real-provider response. */
export function isRealAccepted(mode: AssistantExecutionMode | string, status: AssistantExecutionStatus | string): boolean {
  return mode === 'REAL_PROVIDER' && status === 'ACCEPTED';
}

export function statusLabel(status: AssistantExecutionStatus | string): string {
  switch (status) {
    case 'ACCEPTED': return 'Accepted';
    case 'REAL_REJECTED': return 'Real answer rejected → fallback';
    case 'DETERMINISTIC': return 'Deterministic';
    case 'INSUFFICIENT_EVIDENCE': return 'Insufficient evidence';
    case 'REFUSED': return 'Refused (read-only)';
    case 'FAILED': return 'Failed';
    default: return String(status);
  }
}

/** Provider operating-mode banner. OFFLINE/CONFIGURED are never "real AI active". */
export function providerModeBanner(offline: boolean, llmMode: string): { label: string; tone: 'offline' | 'real' | 'configured' } {
  if (offline || llmMode === 'DETERMINISTIC_FALLBACK') return { label: 'Offline · deterministic fallback (not real AI)', tone: 'offline' };
  if (llmMode === 'REAL_PROVIDER_CONFIGURED') return { label: 'Real provider configured', tone: 'configured' };
  return { label: llmMode, tone: 'configured' };
}

const RICH_TITLES: Record<string, string> = {
  SATELLITE_STATUS_CARD: 'Satellite status',
  TELEMETRY_SUMMARY: 'Telemetry summary',
  TELEMETRY_CHART: 'Telemetry',
  ALERT_SUMMARY: 'Alerts',
  INVESTIGATION_SUMMARY: 'Investigation',
  EVIDENCE_LIST: 'Evidence',
  REPORT_SUMMARY: 'Report',
  KNOWLEDGE_SOURCE_LIST: 'Sources',
  HISTORICAL_INCIDENT_LIST: 'Similar incidents',
  PLANNER_ANALYSIS_CARD: 'Planner analysis (advisory)',
  CRITIC_REVIEW_CARD: 'Critic review (advisory)',
  VALIDATED_ANALYSIS_CARD: 'Validated analysis (advisory)',
  LIMITATIONS_CARD: 'Limitations',
};
export function richContentTitle(type: string): string {
  return RICH_TITLES[type] ?? type;
}

/** Grounding support is a ranking signal — explicitly NOT confidence. */
export function groundingSupportLabel(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(0)}% lexical support`;
}

/** Critic decision label — analysis-quality review only, never a mission decision. */
export function criticDecisionLabel(decision: string | null | undefined): string {
  switch (decision) {
    case 'ACCEPT': return 'Analysis accepted (quality review)';
    case 'REVISE': return 'Revision suggested (quality review)';
    case 'REJECT': return 'Analysis rejected (quality review)';
    default: return '—';
  }
}
