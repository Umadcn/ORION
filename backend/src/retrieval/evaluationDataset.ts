/**
 * Deterministic synthetic ORION retrieval benchmark (Phase 3).
 *
 * Original synthetic content only — the relevant document IDs reference the
 * seeded SYNTHETIC_ORION_CORPUS. Versioned and bounded. Used to MEASURE ranking
 * quality across retrieval modes; it makes no claim about real-world accuracy.
 */
import { normalizeStableDocumentId } from '../knowledge/citations.js';
import type { EvaluationDataset, EvaluationQuery } from './types.js';

export const EVALUATION_DATASET_VERSION = 'orion-eval-v1';

const RAW_QUERIES: EvaluationQuery[] = [
  {
    queryId: 'EVAL-01',
    query: 'payload power converter latch-up over-current anomaly on ORION-3',
    relevantDocumentIds: ['ORION-3-PAYLOAD-POWER-INCIDENT'],
    judgments: [{ stableDocumentId: 'ORION-3-PAYLOAD-POWER-INCIDENT', relevance: 2 }, { stableDocumentId: 'ORION-POWER-OPS-MANUAL', relevance: 1 }],
  },
  {
    queryId: 'EVAL-02',
    query: 'battery degradation end-of-charge voltage decay cell aging',
    relevantDocumentIds: ['ORION-BATTERY-DEGRADATION-REPORT'],
  },
  {
    queryId: 'EVAL-03',
    query: 'thermal control overheating radiator heater response',
    relevantDocumentIds: ['ORION-THERMAL-TROUBLESHOOTING'],
  },
  {
    queryId: 'EVAL-04',
    query: 'S-band communication downlink loss transponder',
    relevantDocumentIds: ['ORION-COMMS-ANOMALY-PROC'],
    judgments: [{ stableDocumentId: 'ORION-COMMS-ANOMALY-PROC', relevance: 2 }, { stableDocumentId: 'ORION-GROUND-LINK-TROUBLESHOOTING', relevance: 1 }],
  },
  {
    queryId: 'EVAL-05',
    query: 'safe mode recovery staged payload reactivation sequence',
    relevantDocumentIds: ['ORION-SAFE-MODE-RECOVERY'],
  },
  {
    queryId: 'EVAL-06',
    query: 'attitude control reaction wheel saturation pointing instability',
    relevantDocumentIds: ['ORION-ADCS-MISSION-RULES'],
  },
  {
    queryId: 'EVAL-07',
    query: 'ground station link symbol lock pass schedule troubleshooting',
    relevantDocumentIds: ['ORION-GROUND-LINK-TROUBLESHOOTING'],
  },
  {
    queryId: 'EVAL-08',
    query: 'power subsystem undervoltage elevated consumption bus voltage',
    relevantDocumentIds: ['ORION-POWER-OPS-MANUAL'],
  },
];

/** Canonicalize document IDs so they match stored (normalized) stable IDs. */
export function getEvaluationDataset(): EvaluationDataset {
  const queries = RAW_QUERIES.map((q) => ({
    ...q,
    relevantDocumentIds: q.relevantDocumentIds.map(normalizeStableDocumentId),
    judgments: q.judgments?.map((j) => ({ ...j, stableDocumentId: normalizeStableDocumentId(j.stableDocumentId) })),
  }));
  return { version: EVALUATION_DATASET_VERSION, queries };
}
