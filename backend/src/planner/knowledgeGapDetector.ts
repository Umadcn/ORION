/**
 * Deterministic knowledge-gap detection (Phase 6). No LLM judge.
 *
 * Decides whether the analysis has enough grounded material (evidence, telemetry,
 * mission-knowledge citations, historical incidents) using configurable bounded
 * thresholds. Explainable + mission-identifier aware.
 */
import { config } from '../config.js';
import type { KnowledgeGap } from './types.js';

export interface GapInputs {
  evidenceCount: number;
  hasTelemetry: boolean;
  citationCount: number;
  historicalCount: number;
  subsystem: string | null;
  anomalyTypes: string[];
  rootCauseLabel: string;
}

export function detectKnowledgeGap(g: GapInputs): KnowledgeGap {
  const missing: string[] = [];
  if (g.citationCount < config.planner.minCitations) missing.push('MISSION_KNOWLEDGE');
  if (g.evidenceCount < config.planner.minEvidenceItems) missing.push('EVIDENCE');
  if (!g.hasTelemetry) missing.push('TELEMETRY');
  if (g.historicalCount === 0) missing.push('HISTORICAL');

  // Sufficiency is driven by the grounding-critical sources (knowledge + evidence).
  const sufficient = g.citationCount >= config.planner.minCitations && g.evidenceCount >= config.planner.minEvidenceItems;

  let type: KnowledgeGap['type'] = 'NONE';
  if (g.citationCount < config.planner.minCitations) type = 'MISSING_KNOWLEDGE';
  else if (g.evidenceCount < config.planner.minEvidenceItems) type = 'MISSING_EVIDENCE';
  else if (!g.hasTelemetry) type = 'MISSING_TELEMETRY';
  else if (g.historicalCount === 0) type = 'MISSING_HISTORICAL';

  const suggestedTerms = Array.from(
    new Set(
      [g.rootCauseLabel, g.subsystem ?? '', ...g.anomalyTypes.map((a) => a.replace(/_/g, ' '))]
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4),
    ),
  ).slice(0, 12);

  return {
    type,
    description: sufficient ? 'Sufficient grounded context for analysis.' : `Insufficient context: missing ${missing.join(', ')}.`,
    missingSourceCategories: missing,
    suggestedTerms,
    sufficient,
  };
}
