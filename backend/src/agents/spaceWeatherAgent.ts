/**
 * Agent 3 — Space Weather Agent.
 * Retrieves normalized space-weather context via the NOAA SWPC adapter
 * (OFFLINE_FIXTURE by default) and assesses whether current conditions could
 * contribute to the incident. Produces provenance-bearing evidence.
 */
import { BaseAgent } from './base.js';
import { getSpaceWeather } from '../integrations/noaaSwpc.js';
import type { AgentStatus, SpaceWeatherEvidence } from '../types.js';

export interface SpaceWeatherInput {
  satelliteId: string;
}

export class SpaceWeatherAgent extends BaseAgent<SpaceWeatherInput, SpaceWeatherEvidence> {
  readonly agent_id = 'space-weather';
  readonly name = 'Space Weather Agent';
  readonly description = 'Retrieves NOAA SWPC space-weather context (offline fixture) and assesses relevance.';

  protected summarizeInput(i: SpaceWeatherInput): string {
    return `Context request for ${i.satelliteId}`;
  }
  protected summarizeOutput(e: SpaceWeatherEvidence): string {
    return `Kp=${e.kp_index}, ${e.geomagnetic_condition}, relevant=${e.relevant_to_incident} [${e.mode}]`;
  }
  protected statusFromOutput(e: SpaceWeatherEvidence): AgentStatus {
    return e.fallback_used ? 'FALLBACK_USED' : 'COMPLETED';
  }

  async execute(): Promise<SpaceWeatherEvidence> {
    const sw = await getSpaceWeather();
    // A geomagnetic storm (Kp >= 5) is considered potentially relevant.
    const relevant = sw.kp_index >= 5;
    const explanation = relevant
      ? `Elevated geomagnetic activity (Kp ${sw.kp_index}, ${sw.geomagnetic_condition}) could plausibly ` +
        `contribute to subsystem anomalies via radiation or charging effects.`
      : `Space weather is ${sw.geomagnetic_condition.toLowerCase()} (Kp ${sw.kp_index}, solar activity ` +
        `${sw.solar_activity}). These conditions do not sufficiently explain the incident.`;

    return {
      solar_activity: sw.solar_activity,
      geomagnetic_condition: sw.geomagnetic_condition,
      kp_index: sw.kp_index,
      relevant_to_incident: relevant,
      explanation,
      source_name: sw.provenance.source_name,
      source_url: sw.provenance.source_url,
      retrieved_at: sw.provenance.retrieved_at,
      mode: sw.provenance.mode,
      cached: sw.provenance.cached,
      fallback_used: sw.provenance.fallback_used,
    };
  }
}
