/**
 * Shared agent contract. Every agent has a stable id/name/description and an
 * execute() method. run() wraps execute() to record an AgentExecution row
 * (timing, status, input/output summaries, errors) for the Agent Execution
 * Timeline shown in the UI. One agent failing must never crash the app.
 */
import { db, now } from '../db.js';
import type { AgentStatus } from '../types.js';

export interface AgentContext {
  investigationId: number;
}

export interface AgentRunResult<O> {
  output: O | null;
  executionId: number;
  status: AgentStatus;
}

export abstract class BaseAgent<I, O> {
  abstract readonly agent_id: string;
  abstract readonly name: string;
  abstract readonly description: string;

  /** Core logic implemented by each agent. */
  abstract execute(input: I, ctx: AgentContext): Promise<O>;

  /** Short human-readable summary of the input (for the execution record). */
  protected summarizeInput(_input: I): string {
    return '';
  }
  /** Short human-readable summary of the output (for the execution record). */
  protected summarizeOutput(_output: O): string {
    return '';
  }
  /** Allow an agent to report FALLBACK_USED based on its output (e.g. adapter fallback). */
  protected statusFromOutput(_output: O): AgentStatus {
    return 'COMPLETED';
  }

  async run(input: I, ctx: AgentContext): Promise<AgentRunResult<O>> {
    const startedAt = now();
    const start = Date.now();
    const insert = db.prepare(
      `INSERT INTO agent_executions
        (investigation_id, agent_id, agent_name, status, started_at, input_summary, output_summary)
       VALUES (?, ?, ?, 'RUNNING', ?, ?, '')`,
    );
    const info = insert.run(ctx.investigationId, this.agent_id, this.name, startedAt, this.safe(() => this.summarizeInput(input)));
    const executionId = Number(info.lastInsertRowid);

    try {
      const output = await this.execute(input, ctx);
      const status = this.statusFromOutput(output);
      const duration = Date.now() - start;
      db.prepare(
        `UPDATE agent_executions
           SET status = ?, completed_at = ?, duration_ms = ?, output_summary = ?
         WHERE id = ?`,
      ).run(status, now(), duration, this.safe(() => this.summarizeOutput(output)), executionId);
      return { output, executionId, status };
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE agent_executions
           SET status = 'FAILED', completed_at = ?, duration_ms = ?, error_message = ?
         WHERE id = ?`,
      ).run(now(), duration, message, executionId);
      return { output: null, executionId, status: 'FAILED' };
    }
  }

  private safe(fn: () => string): string {
    try {
      return fn().slice(0, 500);
    } catch {
      return '';
    }
  }
}

/** Static agent catalog metadata (for GET /api/agents). */
export const AGENT_CATALOG = [
  { agent_id: 'telemetry-monitoring', name: 'Telemetry Monitoring Agent', description: 'Inspects recent telemetry, computes trends and health, flags threshold violations.' },
  { agent_id: 'anomaly-detection', name: 'Anomaly Detection Agent', description: 'Classifies threshold violations into anomalies and assigns severity.' },
  { agent_id: 'space-weather', name: 'Space Weather Agent', description: 'Retrieves NOAA SWPC space-weather context (offline fixture) and assesses relevance.' },
  { agent_id: 'orbit-intelligence', name: 'Orbit Intelligence Agent', description: 'Retrieves CelesTrak orbital/TLE context (offline fixture) and assesses relevance.' },
  { agent_id: 'root-cause-analysis', name: 'Root Cause Analysis Agent', description: 'Combines all evidence via deterministic weighted scoring to determine the root cause.' },
  { agent_id: 'report-generation', name: 'Report Generation Agent', description: 'Generates the structured, printable investigation report.' },
];
