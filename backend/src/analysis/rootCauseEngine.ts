/**
 * Deterministic Root Cause Analysis engine.
 *
 * Combines telemetry observation, detected anomalies, space-weather evidence,
 * and orbit evidence into an explainable conclusion: a single root cause with
 * confidence, severity, supporting/contradicting evidence, recommendations, and
 * a full scoring breakdown. Same inputs => same output, always.
 */
import type {
  InvestigationEvidenceBundle,
  RootCauseAnalysisResult,
  Severity,
} from '../types.js';
import { computeConfidence, computeScores } from './scoring.js';
import { ROOT_CAUSE_INFO } from './rootCauseKnowledgeBase.js';

const SEVERITY_ORDER: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function analyzeRootCause(bundle: InvestigationEvidenceBundle): RootCauseAnalysisResult {
  const { observation, anomalies, spaceWeather, orbit } = bundle;

  const scoring = computeScores({ anomalies, spaceWeather, orbit });

  // No anomalies at all → explicit UNKNOWN with low confidence.
  if (anomalies.detected_anomalies.length === 0 || scoring.length === 0) {
    return {
      root_cause: 'UNKNOWN_ANOMALY',
      confidence: 0.5,
      severity: 'LOW',
      explanation:
        'No threshold-violating anomalies were detected in the telemetry window, so no ' +
        'specific root cause could be established. Continued monitoring is advised.',
      supporting_evidence: [observation.observation_summary],
      contradicting_evidence: [],
      recommended_actions: ROOT_CAUSE_INFO.UNKNOWN_ANOMALY.recommendations,
      scoring_breakdown: scoring,
    };
  }

  const winner = scoring[0];
  const rootCause = winner.root_cause;
  const confidence = computeConfidence(scoring);

  // Severity = max of anomaly severities, escalated to CRITICAL if very confident + HIGH.
  let severity = anomalies.severity;
  if (confidence >= 0.9 && severityIndex(severity) >= severityIndex('HIGH')) {
    severity = 'CRITICAL';
  }

  const info = ROOT_CAUSE_INFO[rootCause];

  // Supporting evidence: contributions that pushed the winner up.
  const supporting: string[] = winner.contributions
    .filter((c) => c.weight > 0)
    .map((c) => c.factor);
  supporting.push(observation.observation_summary);
  if (spaceWeather.relevant_to_incident) {
    supporting.push(`Space weather: ${spaceWeather.explanation}`);
  }
  if (orbit.orbit_deviation_detected && orbit.relevant_to_incident) {
    supporting.push(`Orbit: ${orbit.explanation}`);
  }

  // Contradicting evidence: factors that argue against the chosen cause.
  const contradicting: string[] = [];
  if (!spaceWeather.relevant_to_incident) {
    contradicting.push(
      `Space-weather conditions (${spaceWeather.geomagnetic_condition}, Kp ${spaceWeather.kp_index}) do not sufficiently explain the incident.`,
    );
  }
  if (!orbit.orbit_deviation_detected) {
    contradicting.push('Orbit context indicates no relevant orbital deviation.');
  }
  const negativeContribs = winner.contributions.filter((c) => c.weight < 0).map((c) => c.factor);
  contradicting.push(...negativeContribs);

  const explanation = buildExplanation(rootCause, info.label, confidence, severity, winner.normalized, supporting);

  return {
    root_cause: rootCause,
    confidence,
    severity,
    explanation,
    supporting_evidence: dedupe(supporting),
    contradicting_evidence: dedupe(contradicting),
    recommended_actions: info.recommendations,
    scoring_breakdown: scoring,
  };
}

function buildExplanation(
  rootCause: string,
  label: string,
  confidence: number,
  severity: Severity,
  share: number,
  supporting: string[],
): string {
  const pct = Math.round(confidence * 100);
  const sharePct = Math.round(share * 100);
  return (
    `The deterministic evidence-scoring engine identified ${label} (${rootCause}) as the ` +
    `most likely root cause, accounting for ${sharePct}% of the total weighted evidence. ` +
    `Confidence is ${pct}% and severity is assessed as ${severity}. This conclusion is driven ` +
    `primarily by: ${supporting.slice(0, 3).join('; ')}. All recommended actions are advisory ` +
    `and require Mission Director review before any action is taken.`
  );
}

function severityIndex(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityIndex(a) >= severityIndex(b) ? a : b;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}
