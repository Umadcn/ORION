/**
 * Agent 5 — Root Cause Analysis Agent.
 * Combines the telemetry observation, detected anomalies, space-weather
 * evidence, and orbit evidence, then runs the deterministic weighted-scoring
 * engine to produce the root cause, confidence, severity, explanation,
 * supporting/contradicting evidence, recommendations, and scoring breakdown.
 */
import { BaseAgent } from './base.js';
import { analyzeRootCause } from '../analysis/rootCauseEngine.js';
import type { InvestigationEvidenceBundle, RootCauseAnalysisResult } from '../types.js';

export class RootCauseAnalysisAgent extends BaseAgent<InvestigationEvidenceBundle, RootCauseAnalysisResult> {
  readonly agent_id = 'root-cause-analysis';
  readonly name = 'Root Cause Analysis Agent';
  readonly description = 'Combines all evidence via deterministic weighted scoring to determine the root cause.';

  protected summarizeInput(b: InvestigationEvidenceBundle): string {
    return `${b.anomalies.detected_anomalies.length} anomaly(ies) + space-weather + orbit evidence`;
  }
  protected summarizeOutput(r: RootCauseAnalysisResult): string {
    return `${r.root_cause} @ ${Math.round(r.confidence * 100)}% (${r.severity})`;
  }

  async execute(bundle: InvestigationEvidenceBundle): Promise<RootCauseAnalysisResult> {
    return analyzeRootCause(bundle);
  }
}
