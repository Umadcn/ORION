/**
 * Investigation lifecycle: creation, evidence/recommendation storage, applying
 * the RCA result, state transitions (approve/reject/resolve), and queries.
 * State transitions are validated so invalid moves are blocked.
 */
import { db, now, transaction } from '../db.js';
import type {
  AgentExecution,
  Alert,
  Evidence,
  Investigation,
  InvestigationStatus,
  OrbitEvidence,
  Recommendation,
  RootCauseAnalysisResult,
  Severity,
  SpaceWeatherEvidence,
} from '../types.js';

export class InvalidTransitionError extends Error {}
export class NotFoundError extends Error {}

/** An investigation is "open" if it is not resolved and not rejected. */
export function findOpenInvestigation(satelliteId: string): Investigation | undefined {
  return db
    .prepare(
      `SELECT * FROM investigations
        WHERE satellite_id = ? AND status NOT IN ('RESOLVED', 'REJECTED')
        ORDER BY id DESC LIMIT 1`,
    )
    .get(satelliteId) as Investigation | undefined;
}

export function createInvestigation(satelliteId: string, priority: Severity): Investigation {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO investigations (title, satellite_id, status, priority, detected_anomalies, created_at, updated_at)
       VALUES (?, ?, 'DETECTED', ?, '[]', ?, ?)`,
    )
    .run(`${satelliteId} Anomaly Investigation`, satelliteId, priority, ts, ts);
  return getInvestigation(Number(info.lastInsertRowid))!;
}

export function setStatus(id: number, status: InvestigationStatus): void {
  db.prepare(`UPDATE investigations SET status = ?, updated_at = ? WHERE id = ?`).run(status, now(), id);
}

export function setDetectedAnomalies(id: number, anomalyTypes: string[], priority: Severity): void {
  db.prepare(`UPDATE investigations SET detected_anomalies = ?, priority = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(anomalyTypes),
    priority,
    now(),
    id,
  );
}

export function addEvidence(
  investigationId: number,
  e: {
    source_type: Evidence['source_type'];
    source_name: string;
    summary: string;
    details?: unknown;
    reliability_score?: number;
    supports_root_cause?: boolean;
    source_url?: string | null;
    mode?: string | null;
    cached?: boolean;
    fallback_used?: boolean;
  },
): void {
  db.prepare(
    `INSERT INTO evidence
      (investigation_id, source_type, source_name, summary, details, reliability_score, supports_root_cause, timestamp, source_url, mode, cached, fallback_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    investigationId,
    e.source_type,
    e.source_name,
    e.summary,
    JSON.stringify(e.details ?? {}),
    e.reliability_score ?? 0.7,
    e.supports_root_cause ? 1 : 0,
    now(),
    e.source_url ?? null,
    e.mode ?? null,
    e.cached ? 1 : 0,
    e.fallback_used ? 1 : 0,
  );
}

export function addSpaceWeatherEvidence(investigationId: number, ev: SpaceWeatherEvidence): void {
  addEvidence(investigationId, {
    source_type: 'SPACE_WEATHER',
    source_name: ev.source_name,
    summary: ev.explanation,
    details: ev,
    reliability_score: 0.75,
    supports_root_cause: ev.relevant_to_incident,
    source_url: ev.source_url,
    mode: ev.mode,
    cached: ev.cached,
    fallback_used: ev.fallback_used,
  });
}

export function addOrbitEvidence(investigationId: number, ev: OrbitEvidence): void {
  addEvidence(investigationId, {
    source_type: 'ORBIT_DATA',
    source_name: ev.source_name,
    summary: ev.explanation,
    details: ev,
    reliability_score: 0.75,
    supports_root_cause: ev.relevant_to_incident,
    source_url: ev.source_url,
    mode: ev.mode,
    cached: ev.cached,
    fallback_used: ev.fallback_used,
  });
}

export function applyRcaResult(investigationId: number, result: RootCauseAnalysisResult): void {
  transaction(() => {
    db.prepare(
      `UPDATE investigations
         SET root_cause = ?, confidence = ?, severity = ?, explanation = ?,
             scoring_breakdown = ?, priority = ?, status = 'WAITING_FOR_REVIEW', updated_at = ?
       WHERE id = ?`,
    ).run(
      result.root_cause,
      result.confidence,
      result.severity,
      result.explanation,
      JSON.stringify(result.scoring_breakdown),
      result.severity,
      now(),
      investigationId,
    );

    // Store supporting evidence entries.
    for (const s of result.supporting_evidence) {
      addEvidence(investigationId, {
        source_type: 'SYSTEM',
        source_name: 'Root Cause Analysis Agent',
        summary: s,
        reliability_score: 0.8,
        supports_root_cause: true,
      });
    }

    // Store recommendations.
    const insertRec = db.prepare(
      `INSERT INTO recommendations (investigation_id, action, rationale, priority) VALUES (?, ?, ?, ?)`,
    );
    for (const r of result.recommended_actions) {
      insertRec.run(investigationId, r.action, r.rationale, r.priority);
    }
  });
}

// ---------- Transitions ----------

export function approve(id: number): Investigation {
  const inv = requireInvestigation(id);
  if (inv.status !== 'WAITING_FOR_REVIEW') {
    throw new InvalidTransitionError(`Cannot approve from status ${inv.status}`);
  }
  db.prepare(
    `UPDATE investigations SET status = 'APPROVED', review_decision = 'APPROVED', reviewed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(now(), now(), id);
  return getInvestigation(id)!;
}

export function reject(id: number): Investigation {
  const inv = requireInvestigation(id);
  if (inv.status !== 'WAITING_FOR_REVIEW') {
    throw new InvalidTransitionError(`Cannot reject from status ${inv.status}`);
  }
  db.prepare(
    `UPDATE investigations SET status = 'REJECTED', review_decision = 'REJECTED', reviewed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(now(), now(), id);
  // Rejected investigations are considered closed → resolve their alerts.
  db.prepare(`UPDATE alerts SET status = 'RESOLVED' WHERE investigation_id = ?`).run(id);
  return getInvestigation(id)!;
}

export function resolve(id: number): Investigation {
  const inv = requireInvestigation(id);
  if (inv.status !== 'APPROVED' && inv.status !== 'REJECTED') {
    throw new InvalidTransitionError(`Cannot resolve from status ${inv.status}; must be APPROVED or REJECTED`);
  }
  db.prepare(`UPDATE investigations SET status = 'RESOLVED', resolved_at = ?, updated_at = ? WHERE id = ?`).run(
    now(),
    now(),
    id,
  );
  db.prepare(`UPDATE alerts SET status = 'RESOLVED' WHERE investigation_id = ?`).run(id);
  return getInvestigation(id)!;
}

// ---------- Queries ----------

export function getInvestigation(id: number): Investigation | undefined {
  return db.prepare(`SELECT * FROM investigations WHERE id = ?`).get(id) as Investigation | undefined;
}

export function requireInvestigation(id: number): Investigation {
  const inv = getInvestigation(id);
  if (!inv) throw new NotFoundError(`Investigation ${id} not found`);
  return inv;
}

export function listInvestigations(): Investigation[] {
  return db.prepare(`SELECT * FROM investigations ORDER BY id DESC`).all() as Investigation[];
}

export function getEvidence(id: number): Evidence[] {
  return db.prepare(`SELECT * FROM evidence WHERE investigation_id = ? ORDER BY id`).all(id) as Evidence[];
}

export function getRecommendations(id: number): Recommendation[] {
  return db.prepare(`SELECT * FROM recommendations WHERE investigation_id = ? ORDER BY id`).all(id) as Recommendation[];
}

export function getAgentExecutions(id: number): AgentExecution[] {
  return db.prepare(`SELECT * FROM agent_executions WHERE investigation_id = ? ORDER BY id`).all(id) as AgentExecution[];
}

export function getInvestigationAlerts(id: number): Alert[] {
  return db.prepare(`SELECT * FROM alerts WHERE investigation_id = ? ORDER BY id`).all(id) as Alert[];
}
