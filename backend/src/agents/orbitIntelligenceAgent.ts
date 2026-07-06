/**
 * Agent 4 — Orbit Intelligence Agent.
 * Retrieves normalized orbital/TLE context via the CelesTrak adapter
 * (OFFLINE_FIXTURE by default) and determines whether orbital context supports
 * the anomaly. Produces provenance-bearing evidence.
 */
import { BaseAgent } from './base.js';
import { getOrbitFor } from '../integrations/celestrak.js';
import { fixtureProvenance } from '../integrations/base.js';
import type { AgentStatus, OrbitEvidence } from '../types.js';

export interface OrbitIntelligenceInput {
  satelliteId: string;
  currentAltitudeKm: number;
  baselineAltitudeKm: number;
  orbitDeviationDetected: boolean;
}

export class OrbitIntelligenceAgent extends BaseAgent<OrbitIntelligenceInput, OrbitEvidence> {
  readonly agent_id = 'orbit-intelligence';
  readonly name = 'Orbit Intelligence Agent';
  readonly description = 'Retrieves CelesTrak orbital/TLE context (offline fixture) and assesses relevance.';

  protected summarizeInput(i: OrbitIntelligenceInput): string {
    return `${i.satelliteId}: alt=${i.currentAltitudeKm}km, deviation=${i.orbitDeviationDetected}`;
  }
  protected summarizeOutput(e: OrbitEvidence): string {
    return `${e.orbit_type}, deviation=${e.orbit_deviation_detected}, relevant=${e.relevant_to_incident} [${e.mode}]`;
  }
  protected statusFromOutput(e: OrbitEvidence): AgentStatus {
    return e.fallback_used ? 'FALLBACK_USED' : 'COMPLETED';
  }

  async execute(input: OrbitIntelligenceInput): Promise<OrbitEvidence> {
    const orbit = await getOrbitFor(input.satelliteId);

    // If the fixture has no entry, still return usable evidence via a SYSTEM fallback.
    if (!orbit) {
      const prov = fixtureProvenance('CelesTrak', 'https://celestrak.org/NORAD/elements/', false, true);
      return {
        orbit_type: 'UNKNOWN',
        altitude_context: `No orbital record found for ${input.satelliteId}.`,
        tle_summary: 'Unavailable',
        orbit_deviation_detected: input.orbitDeviationDetected,
        relevant_to_incident: input.orbitDeviationDetected,
        explanation: 'No orbital reference data available; relied on telemetry-derived deviation only.',
        source_name: prov.source_name,
        source_url: prov.source_url,
        retrieved_at: prov.retrieved_at,
        mode: prov.mode,
        cached: prov.cached,
        fallback_used: true,
      };
    }

    const relevant = input.orbitDeviationDetected;
    const dev = Math.abs(input.currentAltitudeKm - input.baselineAltitudeKm);
    const explanation = relevant
      ? `Telemetry shows an altitude deviation of ~${round(dev)}km from the reference orbit ` +
        `(${orbit.mean_altitude_km}km ${orbit.orbit_type}). This supports an orbital perturbation.`
      : `Current altitude (~${input.currentAltitudeKm}km) is consistent with the reference orbit ` +
        `(${orbit.mean_altitude_km}km ${orbit.orbit_type}). No relevant orbital deviation detected.`;

    return {
      orbit_type: orbit.orbit_type,
      altitude_context: `Reference mean altitude ${orbit.mean_altitude_km}km, inclination ${orbit.inclination_deg}°, period ${orbit.period_min}min.`,
      tle_summary: `${orbit.tle_line1} | ${orbit.tle_line2}`,
      orbit_deviation_detected: input.orbitDeviationDetected,
      relevant_to_incident: relevant,
      explanation,
      source_name: orbit.provenance.source_name,
      source_url: orbit.provenance.source_url,
      retrieved_at: orbit.provenance.retrieved_at,
      mode: orbit.provenance.mode,
      cached: orbit.provenance.cached,
      fallback_used: orbit.provenance.fallback_used,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
