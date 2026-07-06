/**
 * Satellite Simulation Engine — session-based, human-controlled.
 *
 * A SimulationSession belongs to exactly one PERSISTED satellite. Each session
 * owns its telemetry profile, speed, tick counter, active/expired failures, and
 * an event log — all persisted so state survives a page refresh and a backend
 * restart. There is NO demo concept, NO fixed scenario→satellite mapping, and NO
 * automatic target selection: telemetry is generated only for satellites with an
 * explicit, human-created RUNNING session.
 *
 * On each emission the engine:
 *   1. composes a SIMULATED telemetry sample (profile + deterministic failure
 *      composition — see simulationFailures.ts),
 *   2. persists it via the NORMAL telemetry ingestion path,
 *   3. lets the EXISTING deterministic anomaly engine decide anomalies + alerts,
 *   4. auto-creates an investigation + runs the 6-agent orchestrator once
 *      anomalies persist for a satellite with no open investigation.
 *
 * The engine NEVER creates alerts/investigations directly, NEVER deletes history,
 * and NEVER silently resumes after a restart (RUNNING → INTERRUPTED).
 * Everything is offline and in-process. Nothing controls a real satellite.
 */
import { config } from '../config.js';
import { db, now } from '../db.js';
import { seedIfEmpty } from '../seed/seedData.js';
import {
  getRecentTelemetry,
  insertTelemetry,
  updateSatelliteHealth,
  getSatellite,
} from './telemetryService.js';
import { isSimEligible } from './satelliteService.js';
import { createAlertIfNeeded, linkAlertsToInvestigation } from './anomalyService.js';
import { getThresholds } from './settingsService.js';
import { evaluateViolations, anomalySeverity } from '../analysis/anomalyRules.js';
import * as inv from './investigationService.js';
import { runInvestigation } from '../orchestrator/investigationOrchestrator.js';
import type { DetectedAnomaly, SatelliteStatus, Severity } from '../types.js';
import {
  FAILURE_CATALOG,
  SIMULATION_DEFAULTS,
  catalogForApi,
  composeTelemetry,
  defaultProfile,
  getFailureDefinition,
  isKnownFailureType,
  normalizeFieldConfig,
  type ActiveFailureRuntime,
  type FailureOnset,
  type FailureRecovery,
  type FieldConfig,
  type SimulationFailureType,
  type TelemetryFieldKey,
  type TelemetryProfile,
} from './simulationFailures.js';

export class SimulationValidationError extends Error {
  constructor(message: string, public details?: Record<string, string>) { super(message); }
}
export class SimulationConflictError extends Error {}
export class SimulationNotFoundError extends Error {}

export type SimulationStatus = 'CREATED' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'INTERRUPTED' | 'FAILED';

interface SessionRow {
  id: string;
  satellite_id: string;
  status: SimulationStatus;
  telemetry_profile: string;
  tick_interval_ms: number;
  simulation_speed: number;
  tick_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  paused_at: string | null;
  stopped_at: string | null;
}

interface FailureRow {
  id: string;
  session_id: string;
  satellite_id: string;
  failure_type: SimulationFailureType;
  severity: Severity;
  onset: FailureOnset;
  recovery: FailureRecovery;
  duration_ticks: number | null;
  onset_ticks: number;
  state: 'ACTIVE' | 'EXPIRED' | 'REMOVED';
  injected_at_tick: number;
  expired_at_tick: number | null;
  params_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionOpts {
  telemetryProfile?: Partial<Record<TelemetryFieldKey, Partial<FieldConfig>>>;
  simulationSpeed?: number;
  tickIntervalMs?: number;
}

export interface InjectFailureSpec {
  failureType: string;
  severity?: Severity;
  onset?: FailureOnset;
  recovery?: FailureRecovery;
  durationTicks?: number | null;
  onsetTicks?: number;
}

let idCounter = 0;
function genId(prefix: string): string {
  idCounter += 1;
  // No Math.random / Date.now dependence for determinism in tests; monotonic + time.
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

const ACTIVE_STATES: SimulationStatus[] = ['CREATED', 'RUNNING', 'PAUSED', 'INTERRUPTED'];

class SimulationEngine {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private launching = new Set<string>();       // per-satellite investigation guard
  private accumulators = new Map<string, number>(); // per-session speed accumulator

  // ---------- Catalog + satellite selection ----------

  /** Satellites eligible for simulation (active + sim_eligible). */
  listSimEligibleSatellites() {
    const rows = db.prepare(`SELECT * FROM satellites`).all() as Array<Record<string, unknown>>;
    return rows
      .map((r) => r as unknown as import('../types.js').Satellite)
      .filter((s) => isSimEligible(s))
      .map((s) => {
        const session = this.getActiveSessionForSatellite(s.id);
        const latest = db.prepare(`SELECT COUNT(*) AS c FROM telemetry WHERE satellite_id=?`).get(s.id) as { c: number };
        const alerts = db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE satellite_id=? AND status='ACTIVE'`).get(s.id) as { c: number };
        const invs = db.prepare(`SELECT COUNT(*) AS c FROM investigations WHERE satellite_id=? AND status NOT IN ('RESOLVED','REJECTED')`).get(s.id) as { c: number };
        return {
          id: s.id,
          name: s.display_name || s.name,
          mission: s.mission,
          status: s.status,
          orbit_type: s.orbit_type,
          data_source_mode: s.data_source_mode ?? 'NO_TELEMETRY',
          origin: s.origin ?? 'SEED',
          session_id: session?.id ?? null,
          session_status: session?.status ?? null,
          telemetry_sample_count: latest.c,
          active_alerts: alerts.c,
          open_investigations: invs.c,
        };
      });
  }

  failureCatalog() {
    return catalogForApi();
  }

  // ---------- Session persistence ----------

  private getSessionRow(id: string): SessionRow | undefined {
    return db.prepare(`SELECT * FROM simulation_sessions WHERE id=?`).get(id) as SessionRow | undefined;
  }

  private requireSessionRow(id: string): SessionRow {
    const row = this.getSessionRow(id);
    if (!row) throw new SimulationNotFoundError(`Simulation session ${id} not found`);
    return row;
  }

  /** The one non-terminal (CREATED/RUNNING/PAUSED/INTERRUPTED) session for a satellite, if any. */
  getActiveSessionForSatellite(satelliteId: string): SessionRow | undefined {
    return db.prepare(
      `SELECT * FROM simulation_sessions WHERE satellite_id=? AND status IN ('CREATED','RUNNING','PAUSED','INTERRUPTED') ORDER BY created_at DESC LIMIT 1`,
    ).get(satelliteId) as SessionRow | undefined;
  }

  listSessions(): SessionRow[] {
    return db.prepare(`SELECT * FROM simulation_sessions ORDER BY created_at DESC`).all() as SessionRow[];
  }

  private parseProfile(json: string): TelemetryProfile {
    let raw: Record<string, Partial<FieldConfig>> = {};
    try { raw = JSON.parse(json) as Record<string, Partial<FieldConfig>>; } catch { raw = {}; }
    const base = defaultProfile({});
    const out = { ...base };
    for (const key of Object.keys(base) as TelemetryFieldKey[]) {
      if (raw[key]) out[key] = normalizeFieldConfig(key, raw[key], base[key]);
    }
    return out;
  }

  // ---------- Session lifecycle ----------

  createSession(satelliteId: string, opts: CreateSessionOpts, createdBy: string): SessionRow {
    const sat = getSatellite(satelliteId);
    if (!sat) throw new SimulationValidationError(`Unknown satellite ${satelliteId}`, { satellite_id: 'unknown satellite' });
    if (!isSimEligible(sat)) throw new SimulationValidationError(`Satellite ${satelliteId} is not eligible for simulation (archived or sim-disabled)`, { satellite_id: 'not simulation-eligible' });

    // Only one non-terminal session per satellite — reuse it (idempotent create).
    const existing = this.getActiveSessionForSatellite(satelliteId);
    if (existing) {
      if (opts.telemetryProfile) this.updateConfig(existing.id, opts.telemetryProfile);
      if (opts.simulationSpeed) this.setSpeed(existing.id, opts.simulationSpeed);
      return this.getSessionRow(existing.id)!;
    }

    // Derive a default profile from persisted satellite metadata (never copied from another satellite).
    const profile = defaultProfile({
      altitude: sat.altitude > 0 ? sat.altitude : undefined,
      battery: 100, temperature: 22, power: 600, signal: -95,
    });
    if (opts.telemetryProfile) {
      for (const key of Object.keys(profile) as TelemetryFieldKey[]) {
        if (opts.telemetryProfile[key]) profile[key] = normalizeFieldConfig(key, opts.telemetryProfile[key]!, profile[key]);
      }
    }
    const speed = this.validateSpeed(opts.simulationSpeed ?? 1);
    const interval = this.intervalForSpeed(speed);
    const ts = now();
    const id = genId('sess');
    db.prepare(
      `INSERT INTO simulation_sessions (id, satellite_id, status, telemetry_profile, tick_interval_ms, simulation_speed, tick_count, created_by, created_at, updated_at)
       VALUES (?, ?, 'CREATED', ?, ?, ?, 0, ?, ?, ?)`,
    ).run(id, satelliteId, JSON.stringify(profile), interval, speed, createdBy, ts, ts);
    this.logEvent(id, satelliteId, 'SESSION_CREATED', `Simulation session created for ${satelliteId}.`, createdBy);
    return this.getSessionRow(id)!;
  }

  startSession(id: string, actor?: string): SessionRow {
    const row = this.requireSessionRow(id);
    if (row.status === 'RUNNING') return row;
    if (!['CREATED', 'PAUSED', 'STOPPED', 'INTERRUPTED'].includes(row.status)) {
      throw new SimulationConflictError(`Cannot start a session in status ${row.status}`);
    }
    const sat = getSatellite(row.satellite_id);
    if (!sat || !isSimEligible(sat)) throw new SimulationConflictError(`Satellite ${row.satellite_id} is no longer simulation-eligible`);
    db.prepare(`UPDATE simulation_sessions SET status='RUNNING', started_at=COALESCE(started_at, ?), paused_at=NULL, stopped_at=NULL, updated_at=? WHERE id=?`).run(now(), now(), id);
    db.prepare(`UPDATE satellites SET data_source_mode='SIMULATED', updated_at=? WHERE id=?`).run(now(), row.satellite_id);
    this.logEvent(id, row.satellite_id, 'SIMULATION_STARTED', `Simulation started for ${row.satellite_id}.`, actor);
    this.ensureTicker();
    return this.getSessionRow(id)!;
  }

  pauseSession(id: string, actor?: string): SessionRow {
    const row = this.requireSessionRow(id);
    if (row.status === 'PAUSED') return row;
    if (row.status !== 'RUNNING') throw new SimulationConflictError(`Cannot pause a session in status ${row.status}`);
    db.prepare(`UPDATE simulation_sessions SET status='PAUSED', paused_at=?, updated_at=? WHERE id=?`).run(now(), now(), id);
    this.logEvent(id, row.satellite_id, 'SIMULATION_PAUSED', `Simulation paused for ${row.satellite_id}.`, actor);
    this.stopTickerIfIdle();
    return this.getSessionRow(id)!;
  }

  resumeSession(id: string, actor?: string): SessionRow {
    const row = this.requireSessionRow(id);
    if (row.status === 'RUNNING') return row;
    if (!['PAUSED', 'INTERRUPTED'].includes(row.status)) throw new SimulationConflictError(`Cannot resume a session in status ${row.status}`);
    db.prepare(`UPDATE simulation_sessions SET status='RUNNING', paused_at=NULL, updated_at=? WHERE id=?`).run(now(), id);
    this.logEvent(id, row.satellite_id, 'SIMULATION_RESUMED', `Simulation resumed for ${row.satellite_id}.`, actor);
    this.ensureTicker();
    return this.getSessionRow(id)!;
  }

  stopSession(id: string, actor?: string): SessionRow {
    const row = this.requireSessionRow(id);
    if (row.status === 'STOPPED') return row;
    db.prepare(`UPDATE simulation_sessions SET status='STOPPED', stopped_at=?, updated_at=? WHERE id=?`).run(now(), now(), id);
    this.accumulators.delete(id);
    this.logEvent(id, row.satellite_id, 'SIMULATION_STOPPED', `Simulation stopped for ${row.satellite_id}. Telemetry history, alerts and investigations are preserved.`, actor);
    this.stopTickerIfIdle();
    return this.getSessionRow(id)!;
  }

  // ---------- Speed + config ----------

  private validateSpeed(speed: number): number {
    if (!Number.isFinite(speed) || speed <= 0) throw new SimulationValidationError('simulationSpeed must be a positive number', { simulationSpeed: 'must be > 0' });
    if (!SIMULATION_DEFAULTS.allowedSpeeds.includes(speed)) {
      throw new SimulationValidationError(`simulationSpeed must be one of ${SIMULATION_DEFAULTS.allowedSpeeds.join(', ')}`, { simulationSpeed: `one of ${SIMULATION_DEFAULTS.allowedSpeeds.join(', ')}` });
    }
    return speed;
  }

  private intervalForSpeed(speed: number): number {
    const raw = Math.round(SIMULATION_DEFAULTS.baseTickIntervalMs / speed);
    return Math.max(SIMULATION_DEFAULTS.minTickIntervalMs, Math.min(SIMULATION_DEFAULTS.maxTickIntervalMs, raw));
  }

  setSpeed(id: string, speed: number, actor?: string): SessionRow {
    const row = this.requireSessionRow(id);
    const validated = this.validateSpeed(speed);
    db.prepare(`UPDATE simulation_sessions SET simulation_speed=?, tick_interval_ms=?, updated_at=? WHERE id=?`).run(validated, this.intervalForSpeed(validated), now(), id);
    this.logEvent(id, row.satellite_id, 'SPEED_CHANGED', `Simulation speed set to ${validated}x for ${row.satellite_id}.`, actor);
    return this.getSessionRow(id)!;
  }

  updateConfig(id: string, patch: Partial<Record<TelemetryFieldKey, Partial<FieldConfig>>>, actor?: string): SessionRow {
    const row = this.requireSessionRow(id);
    const profile = this.parseProfile(row.telemetry_profile);
    const touched: string[] = [];
    for (const key of Object.keys(profile) as TelemetryFieldKey[]) {
      if (patch[key]) { profile[key] = normalizeFieldConfig(key, patch[key]!, profile[key]); touched.push(key); }
    }
    if (touched.length === 0) throw new SimulationValidationError('No valid telemetry fields to update', { telemetryProfile: 'no recognized fields' });
    db.prepare(`UPDATE simulation_sessions SET telemetry_profile=?, updated_at=? WHERE id=?`).run(JSON.stringify(profile), now(), id);
    this.logEvent(id, row.satellite_id, 'TELEMETRY_CONFIG_CHANGED', `Telemetry configuration updated (${touched.join(', ')}). Future telemetry only; history unchanged.`, actor);
    return this.getSessionRow(id)!;
  }

  getProfile(id: string): TelemetryProfile {
    return this.parseProfile(this.requireSessionRow(id).telemetry_profile);
  }

  // ---------- Failures ----------

  private validateFailureSpec(spec: InjectFailureSpec): Required<Omit<InjectFailureSpec, 'durationTicks'>> & { durationTicks: number | null } {
    const errors: Record<string, string> = {};
    if (!spec.failureType || !isKnownFailureType(spec.failureType)) {
      errors.failureType = `failureType must be one of ${FAILURE_CATALOG.map((d) => d.failureType).join(', ')}`;
    }
    const def = isKnownFailureType(spec.failureType) ? getFailureDefinition(spec.failureType)! : undefined;
    const severity = (spec.severity ?? def?.defaultSeverity ?? 'MEDIUM') as Severity;
    if (def && !def.supportedSeverityLevels.includes(severity)) errors.severity = `severity must be one of ${def.supportedSeverityLevels.join(', ')}`;
    const onset: FailureOnset = spec.onset === 'GRADUAL' ? 'GRADUAL' : 'IMMEDIATE';
    const recovery: FailureRecovery = ['IMMEDIATE', 'LINEAR', 'GRADUAL'].includes(spec.recovery as string) ? (spec.recovery as FailureRecovery) : 'IMMEDIATE';
    let durationTicks: number | null = null;
    if (spec.durationTicks !== undefined && spec.durationTicks !== null) {
      const d = Number(spec.durationTicks);
      if (!Number.isFinite(d) || d < 1 || d > 100000) errors.durationTicks = 'durationTicks must be between 1 and 100000';
      else durationTicks = Math.floor(d);
    }
    let onsetTicks = SIMULATION_DEFAULTS.onsetTicks;
    if (spec.onsetTicks !== undefined && spec.onsetTicks !== null) {
      const o = Number(spec.onsetTicks);
      if (!Number.isFinite(o) || o < 0 || o > 10000) errors.onsetTicks = 'onsetTicks must be between 0 and 10000';
      else onsetTicks = Math.floor(o);
    }
    if (Object.keys(errors).length) throw new SimulationValidationError('Invalid failure specification', errors);
    return { failureType: spec.failureType as SimulationFailureType, severity, onset, recovery, durationTicks, onsetTicks };
  }

  injectFailureToSession(id: string, spec: InjectFailureSpec, actor?: string): FailureRow {
    const row = this.requireSessionRow(id);
    if (!['RUNNING', 'PAUSED', 'CREATED'].includes(row.status)) {
      throw new SimulationConflictError(`Cannot inject a failure into a session in status ${row.status}`);
    }
    const v = this.validateFailureSpec(spec);
    const ts = now();
    const failureId = genId('fail');
    db.prepare(
      `INSERT INTO simulation_failures (id, session_id, satellite_id, failure_type, severity, onset, recovery, duration_ticks, onset_ticks, state, injected_at_tick, expired_at_tick, params_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, '{}', ?, ?)`,
    ).run(failureId, id, row.satellite_id, v.failureType, v.severity, v.onset, v.recovery, v.durationTicks, v.onsetTicks, row.tick_count, ts, ts);
    this.logEvent(id, row.satellite_id, 'FAILURE_INJECTED', `Injected ${v.failureType} (${v.severity}${v.durationTicks ? `, ${v.durationTicks} ticks` : ''}) into ${row.satellite_id}.`, actor);
    return db.prepare(`SELECT * FROM simulation_failures WHERE id=?`).get(failureId) as FailureRow;
  }

  listSessionFailures(id: string): FailureRow[] {
    this.requireSessionRow(id);
    return db.prepare(`SELECT * FROM simulation_failures WHERE session_id=? ORDER BY created_at`).all(id) as FailureRow[];
  }

  removeFailure(sessionId: string, failureId: string, actor?: string): void {
    const row = this.requireSessionRow(sessionId);
    const failure = db.prepare(`SELECT * FROM simulation_failures WHERE id=? AND session_id=?`).get(failureId, sessionId) as FailureRow | undefined;
    if (!failure) throw new SimulationNotFoundError(`Failure ${failureId} not found in session ${sessionId}`);
    if (failure.state === 'REMOVED') return;
    db.prepare(`UPDATE simulation_failures SET state='REMOVED', updated_at=? WHERE id=?`).run(now(), failureId);
    this.logEvent(sessionId, row.satellite_id, 'FAILURE_REMOVED', `Removed ${failure.failure_type} from ${row.satellite_id}. Simulation continues.`, actor);
  }

  clearFailures(sessionId: string, actor?: string): number {
    const row = this.requireSessionRow(sessionId);
    const info = db.prepare(`UPDATE simulation_failures SET state='REMOVED', updated_at=? WHERE session_id=? AND state IN ('ACTIVE','EXPIRED')`).run(now(), sessionId);
    const count = Number(info.changes);
    this.logEvent(sessionId, row.satellite_id, 'FAILURES_CLEARED', `Cleared ${count} active failure(s) from ${row.satellite_id}. History preserved.`, actor);
    return count;
  }

  private loadRuntimeFailures(sessionId: string): ActiveFailureRuntime[] {
    const rows = db.prepare(`SELECT * FROM simulation_failures WHERE session_id=? AND state != 'REMOVED'`).all(sessionId) as FailureRow[];
    return rows.map((r) => ({
      id: r.id,
      failureType: r.failure_type,
      severity: r.severity,
      onset: r.onset,
      recovery: r.recovery,
      onsetTicks: r.onset_ticks,
      durationTicks: r.duration_ticks,
      injectedAtTick: r.injected_at_tick,
      state: r.state,
      expiredAtTick: r.expired_at_tick,
    }));
  }

  // ---------- Events ----------

  private logEvent(sessionId: string | null, satelliteId: string | null, eventType: string, summary: string, actor?: string): void {
    db.prepare(
      `INSERT INTO simulation_events (session_id, satellite_id, event_type, summary, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(sessionId, satelliteId, eventType, summary.slice(0, 400), actor ?? null, now());
    // Bounded retention.
    const max = config.assistant.maxEvents; // reuse a sane bound (200)
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM simulation_events`).get() as { c: number }).c;
    if (count > max * 4) {
      db.prepare(`DELETE FROM simulation_events WHERE id NOT IN (SELECT id FROM simulation_events ORDER BY id DESC LIMIT ?)`).run(max * 4);
    }
  }

  getSessionEvents(sessionId: string, limit = 100): Array<Record<string, unknown>> {
    this.requireSessionRow(sessionId);
    return db.prepare(`SELECT * FROM simulation_events WHERE session_id=? ORDER BY id DESC LIMIT ?`).all(sessionId, Math.min(500, Math.max(1, limit))) as Array<Record<string, unknown>>;
  }

  getSessionTelemetry(sessionId: string, limit = 60) {
    const row = this.requireSessionRow(sessionId);
    return getRecentTelemetry(row.satellite_id, Math.min(500, Math.max(1, limit)));
  }

  // ---------- Ticking ----------

  private ensureTicker(): void {
    if (this.timer) return;
    if (!this.hasRunning()) return;
    // In-memory (test) databases drive ticks deterministically via tickOnce();
    // never start a background interval there (avoids nondeterminism + open handles).
    if (config.dbFile === ':memory:') return;
    this.timer = setInterval(() => { void this.tickSafe(); }, SIMULATION_DEFAULTS.baseTickIntervalMs);
    void this.tickSafe();
  }

  private stopTickerIfIdle(): void {
    if (this.timer && !this.hasRunning()) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private hasRunning(): boolean {
    return (db.prepare(`SELECT COUNT(*) AS c FROM simulation_sessions WHERE status='RUNNING'`).get() as { c: number }).c > 0;
  }

  private runningSessions(): SessionRow[] {
    return db.prepare(`SELECT * FROM simulation_sessions WHERE status='RUNNING'`).all() as SessionRow[];
  }

  private async tickSafe(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const row of this.runningSessions()) {
        const speed = row.simulation_speed;
        let acc = (this.accumulators.get(row.id) ?? 0) + speed;
        let count = Math.floor(acc);
        acc -= count;
        this.accumulators.set(row.id, acc);
        count = Math.min(count, SIMULATION_DEFAULTS.maxSamplesPerTick);
        for (let i = 0; i < count; i++) await this.emitSample(row.id);
      }
    } catch (err) {
      this.logEvent(null, null, 'TICK_ERROR', `Tick error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
      this.stopTickerIfIdle();
    }
  }

  /** Public single-tick used by tests: emits exactly one sample per RUNNING session. */
  async tickOnce(): Promise<void> {
    for (const row of this.runningSessions()) {
      await this.emitSample(row.id);
    }
  }

  private async emitSample(sessionId: string): Promise<void> {
    const row = this.getSessionRow(sessionId);
    if (!row || row.status !== 'RUNNING') return;
    const tick = row.tick_count + 1;
    const thresholds = getThresholds();

    // Expire duration-bounded failures whose window has elapsed.
    this.expireDueFailures(row, tick);

    const profile = this.parseProfile(row.telemetry_profile);
    const failures = this.loadRuntimeFailures(row.id);
    const sat = getSatellite(row.satellite_id);
    const orbit = { velocity: sat && sat.velocity > 0 ? sat.velocity : 7.5, latitude: sat?.latitude ?? 0, longitude: sat?.longitude ?? 0 };

    const { sample } = composeTelemetry(profile, tick, tick, failures, orbit);
    insertTelemetry({ satellite_id: row.satellite_id, timestamp: now(), ...sample });
    db.prepare(`UPDATE simulation_sessions SET tick_count=?, updated_at=? WHERE id=?`).run(tick, now(), row.id);

    const health = this.healthFrom(sample, thresholds);
    updateSatelliteHealth(row.satellite_id, health, this.statusFrom(health));

    const need = Math.max(thresholds.min_persisted_samples + 2, 6);
    const window = getRecentTelemetry(row.satellite_id, need);
    const violations = evaluateViolations(window, thresholds, profile.altitude_km.baseline);
    const detected: DetectedAnomaly[] = violations.map((v) => ({
      type: v.anomaly_type,
      severity: anomalySeverity(v.anomaly_type, v.value, v.threshold),
      value: v.value,
      threshold: v.threshold,
      persisted_samples: v.samples_violating,
      description: `${v.anomaly_type}: ${v.metric}=${v.value} vs threshold ${v.threshold} (${v.samples_violating} samples)`,
    }));

    for (const anomaly of detected) {
      const created = createAlertIfNeeded(row.satellite_id, anomaly);
      if (created?.isNew) {
        this.logEvent(row.id, row.satellite_id, 'ANOMALY_DETECTED', `${anomaly.type} (${anomaly.severity}) detected on ${row.satellite_id}.`);
        this.logEvent(row.id, row.satellite_id, 'ALERT_CREATED', `Alert raised: ${anomaly.type} (${anomaly.severity}).`);
      }
    }
    // Link any active alerts to an already-open investigation so late-arriving
    // anomalies (e.g. power crosses after battery) are attached to the same case.
    const open = inv.findOpenInvestigation(row.satellite_id);
    if (open) linkAlertsToInvestigation(row.satellite_id, open.id);
    if (detected.length > 0) await this.maybeLaunchInvestigation(row.id, row.satellite_id, detected);
  }

  private expireDueFailures(row: SessionRow, tick: number): void {
    const due = db.prepare(
      `SELECT * FROM simulation_failures WHERE session_id=? AND state='ACTIVE' AND duration_ticks IS NOT NULL AND (? - injected_at_tick) >= duration_ticks`,
    ).all(row.id, tick) as FailureRow[];
    for (const f of due) {
      db.prepare(`UPDATE simulation_failures SET state='EXPIRED', expired_at_tick=?, updated_at=? WHERE id=?`).run(tick, now(), f.id);
      this.logEvent(row.id, row.satellite_id, 'FAILURE_EXPIRED', `${f.failure_type} expired on ${row.satellite_id}; telemetry recovering (${f.recovery.toLowerCase()}).`);
    }
  }

  private async maybeLaunchInvestigation(sessionId: string, satelliteId: string, detected: DetectedAnomaly[]): Promise<void> {
    if (this.launching.has(satelliteId)) return;
    if (inv.findOpenInvestigation(satelliteId)) return;
    this.launching.add(satelliteId);
    try {
      const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      const priority = detected.map((d) => d.severity).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] as Severity;
      const investigation = inv.createInvestigation(satelliteId, priority);
      this.logEvent(sessionId, satelliteId, 'INVESTIGATION_CREATED', `Investigation #${investigation.id} auto-created for ${satelliteId}.`);
      const result = await runInvestigation(investigation.id);
      this.logEvent(sessionId, satelliteId, 'INVESTIGATION_ANALYZED', `Investigation #${investigation.id} analysis complete → ${result.rootCause ?? 'inconclusive'}.`);
    } finally {
      this.launching.delete(satelliteId);
    }
  }

  private healthFrom(t: { battery_percent: number; temperature_c: number; signal_strength_dbm: number; power_consumption_w: number }, th: ReturnType<typeof getThresholds>): number {
    let score = 100;
    if (t.battery_percent < th.low_battery_percent) score -= (th.low_battery_percent - t.battery_percent) * 1.5;
    else score -= Math.max(0, 60 - t.battery_percent) * 0.2;
    if (t.temperature_c > th.high_temperature_c) score -= (t.temperature_c - th.high_temperature_c) * 1.2;
    if (t.signal_strength_dbm < th.comm_loss_dbm) score -= Math.abs(t.signal_strength_dbm - th.comm_loss_dbm) * 1.0;
    if (t.power_consumption_w > th.abnormal_power_w) score -= (t.power_consumption_w - th.abnormal_power_w) * 0.05;
    return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
  }

  private statusFrom(health: number): SatelliteStatus {
    if (health >= 80) return 'HEALTHY';
    if (health >= 55) return 'WARNING';
    if (health > 0) return 'ALERT';
    return 'OFFLINE';
  }

  // ---------- Restart recovery ----------

  /** On process start, no RUNNING session may silently resume. RUNNING → INTERRUPTED. */
  recoverAfterRestart(): void {
    db.prepare(`UPDATE simulation_sessions SET status='INTERRUPTED', updated_at=? WHERE status='RUNNING'`).run(now());
    this.accumulators.clear();
  }

  // ---------- Backward-compatible convenience API ----------

  isRunning(): boolean {
    return this.hasRunning();
  }

  /** Satellite ids with a RUNNING session (used by the satellites API). */
  activeTargets(): string[] {
    return (db.prepare(`SELECT DISTINCT satellite_id FROM simulation_sessions WHERE status='RUNNING'`).all() as { satellite_id: string }[]).map((r) => r.satellite_id);
  }

  /** Explicitly start (create if needed) a default simulation session for a satellite. */
  startForSatellite(satelliteId: string, createdBy = 'system'): { ok: boolean; message: string; sessionId?: string } {
    const sat = getSatellite(satelliteId);
    if (!sat) return { ok: false, message: `Unknown satellite ${satelliteId}` };
    if (!isSimEligible(sat)) return { ok: false, message: `Satellite ${satelliteId} is not eligible for simulation (archived or sim-disabled)` };
    let session = this.getActiveSessionForSatellite(satelliteId);
    if (!session) session = this.createSession(satelliteId, {}, createdBy);
    if (session.status !== 'RUNNING') this.startSession(session.id, createdBy);
    return { ok: true, message: `Simulation started for ${satelliteId}`, sessionId: session.id };
  }

  /** Stop simulating a satellite (stops all its non-terminal sessions). */
  stopForSatellite(satelliteId: string, actor = 'system'): { ok: boolean; message: string } {
    const sessions = db.prepare(`SELECT id FROM simulation_sessions WHERE satellite_id=? AND status IN ('RUNNING','PAUSED')`).all(satelliteId) as { id: string }[];
    for (const s of sessions) this.stopSession(s.id, actor);
    return { ok: sessions.length > 0, message: sessions.length > 0 ? `Simulation stopped for ${satelliteId}` : `${satelliteId} was not being simulated` };
  }

  /** Legacy convenience: ensure a running session for a satellite and inject a failure. */
  injectFailure(satelliteId: string, failureType: string, opts: Omit<InjectFailureSpec, 'failureType'> = {}, actor = 'system'): { ok: boolean; message: string; sessionId?: string; failureId?: string } {
    const started = this.startForSatellite(satelliteId, actor);
    if (!started.ok || !started.sessionId) return { ok: false, message: started.message };
    const failure = this.injectFailureToSession(started.sessionId, { failureType, ...opts }, actor);
    return { ok: true, message: `${failureType} injected into ${satelliteId}`, sessionId: started.sessionId, failureId: failure.id };
  }

  /** Compact status snapshot (used by satellites API + observability). */
  status() {
    const sessions = this.listSessions();
    const active = db.prepare(`SELECT * FROM simulation_failures WHERE state='ACTIVE'`).all() as FailureRow[];
    const events = db.prepare(`SELECT * FROM simulation_events ORDER BY id DESC LIMIT 25`).all() as Array<Record<string, unknown>>;
    return {
      running: this.isRunning(),
      active_session_count: sessions.filter((s) => s.status === 'RUNNING').length,
      simulated_satellites: this.activeTargets(),
      sessions: sessions.map((s) => ({ id: s.id, satellite_id: s.satellite_id, status: s.status, tick_count: s.tick_count, simulation_speed: s.simulation_speed })),
      active_failures: active.map((f) => ({ session_id: f.session_id, satellite_id: f.satellite_id, failure_type: f.failure_type, severity: f.severity, state: f.state })),
      recent_events: events,
    };
  }

  /** Serialize a session for API responses (adds derived fields). */
  serializeSession(id: string) {
    const row = this.requireSessionRow(id);
    const failures = this.listSessionFailures(id);
    const sat = getSatellite(row.satellite_id);
    return {
      id: row.id,
      satellite_id: row.satellite_id,
      satellite_name: sat?.display_name || sat?.name || row.satellite_id,
      status: row.status,
      telemetry_profile: this.parseProfile(row.telemetry_profile),
      tick_interval_ms: row.tick_interval_ms,
      simulation_speed: row.simulation_speed,
      tick_count: row.tick_count,
      telemetry_source: 'SIMULATED',
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      started_at: row.started_at,
      paused_at: row.paused_at,
      stopped_at: row.stopped_at,
      active_failures: failures.filter((f) => f.state === 'ACTIVE').length,
      failures: failures.map((f) => this.serializeFailure(f, row.tick_count)),
    };
  }

  serializeFailure(f: FailureRow, currentTick: number) {
    const def = getFailureDefinition(f.failure_type);
    const n = currentTick - f.injected_at_tick;
    const remaining = f.duration_ticks != null && f.state === 'ACTIVE' ? Math.max(0, f.duration_ticks - n) : null;
    return {
      id: f.id,
      failure_type: f.failure_type,
      display_name: def?.displayName ?? f.failure_type,
      severity: f.severity,
      onset: f.onset,
      recovery: f.recovery,
      duration_ticks: f.duration_ticks,
      remaining_ticks: remaining,
      onset_ticks: f.onset_ticks,
      state: f.state,
      injected_at_tick: f.injected_at_tick,
      expired_at_tick: f.expired_at_tick,
      affected_fields: def?.affectedTelemetryFields ?? [],
      expected_alert_types: def?.expectedAlertTypes ?? [],
    };
  }
}

/** Ensure DB is seeded + no session silently resumes after a restart. */
export function initSimulation(): void {
  seedIfEmpty();
  simulation.recoverAfterRestart();
}

export const simulation = new SimulationEngine();
