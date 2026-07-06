/**
 * Investigation Orchestrator.
 *
 * Sequentially executes the agent pipeline for one investigation, recording
 * every agent execution and storing evidence + RCA results. Sequential
 * execution is deliberate: it is reliable and easy to reason about. A single
 * agent failure is recorded honestly and does not crash the process.
 *
 * Pipeline:
 *   Telemetry Monitoring → Anomaly Detection → (link alerts) →
 *   Space Weather → Orbit Intelligence → Root Cause Analysis → WAITING_FOR_REVIEW
 */
import { TelemetryMonitoringAgent } from '../agents/telemetryMonitoringAgent.js';
import { AnomalyDetectionAgent } from '../agents/anomalyDetectionAgent.js';
import { SpaceWeatherAgent } from '../agents/spaceWeatherAgent.js';
import { OrbitIntelligenceAgent } from '../agents/orbitIntelligenceAgent.js';
import { RootCauseAnalysisAgent } from '../agents/rootCauseAnalysisAgent.js';
import { getRecentTelemetry, getSatellite } from '../services/telemetryService.js';
import { getThresholds } from '../services/settingsService.js';
import { linkAlertsToInvestigation } from '../services/anomalyService.js';
import * as inv from '../services/investigationService.js';
import { getSeedFor } from '../seed/seedData.js';
import type { AnomalyDetectionResult, SpaceWeatherEvidence, OrbitEvidence } from '../types.js';

export interface OrchestratorResult {
  investigationId: number;
  completed: boolean;
  rootCause: string | null;
}

export async function runInvestigation(investigationId: number): Promise<OrchestratorResult> {
  const investigation = inv.requireInvestigation(investigationId);
  const satelliteId = investigation.satellite_id;
  const satellite = getSatellite(satelliteId);
  const baseline = getSeedFor(satelliteId)?.altitude ?? satellite?.altitude ?? 0;

  inv.setStatus(investigationId, 'ANALYZING');
  const ctx = { investigationId };

  // 1) Telemetry Monitoring Agent
  const samples = getRecentTelemetry(satelliteId, 30);
  const thresholds = getThresholds();
  const monitoring = await new TelemetryMonitoringAgent().run(
    { satelliteId, samples, thresholds, baselineAltitude: baseline },
    ctx,
  );
  if (!monitoring.output) {
    return { investigationId, completed: false, rootCause: null };
  }
  const observation = monitoring.output;
  inv.addEvidence(investigationId, {
    source_type: 'TELEMETRY',
    source_name: 'Telemetry Monitoring Agent',
    summary: observation.observation_summary,
    details: observation,
    reliability_score: 0.9,
    supports_root_cause: observation.threshold_violations.length > 0,
  });

  // 2) Anomaly Detection Agent
  const detection = await new AnomalyDetectionAgent().run(observation, ctx);
  const anomalyResult: AnomalyDetectionResult =
    detection.output ?? { detected_anomalies: [], severity: 'LOW', evidence: [], summary: 'No anomalies.' };
  for (const a of anomalyResult.detected_anomalies) {
    inv.addEvidence(investigationId, {
      source_type: 'ANOMALY_RULE',
      source_name: 'Anomaly Detection Agent',
      summary: a.description,
      details: a,
      reliability_score: 0.85,
      supports_root_cause: true,
    });
  }
  const anomalyTypes = anomalyResult.detected_anomalies.map((a) => a.type);
  inv.setDetectedAnomalies(investigationId, anomalyTypes, anomalyResult.severity);

  // Link any active alerts for this satellite to the investigation.
  linkAlertsToInvestigation(satelliteId, investigationId);

  // 3) Space Weather Agent
  const sw = await new SpaceWeatherAgent().run({ satelliteId }, ctx);
  const spaceWeather: SpaceWeatherEvidence =
    sw.output ?? defaultSpaceWeather();
  inv.addSpaceWeatherEvidence(investigationId, spaceWeather);

  // 4) Orbit Intelligence Agent
  const orbitDeviation = observation.threshold_violations.some((v) => v.anomaly_type === 'ORBIT_DEVIATION');
  const orbitRun = await new OrbitIntelligenceAgent().run(
    {
      satelliteId,
      currentAltitudeKm: observation.latest_values.altitude_km,
      baselineAltitudeKm: baseline,
      orbitDeviationDetected: orbitDeviation,
    },
    ctx,
  );
  const orbit: OrbitEvidence = orbitRun.output ?? defaultOrbit(baseline);
  inv.addOrbitEvidence(investigationId, orbit);

  // 5) Root Cause Analysis Agent
  const rca = await new RootCauseAnalysisAgent().run(
    { observation, anomalies: anomalyResult, spaceWeather, orbit },
    ctx,
  );
  if (!rca.output) {
    inv.setStatus(investigationId, 'WAITING_FOR_REVIEW');
    return { investigationId, completed: false, rootCause: null };
  }

  inv.applyRcaResult(investigationId, rca.output);
  return { investigationId, completed: true, rootCause: rca.output.root_cause };
}

function defaultSpaceWeather(): SpaceWeatherEvidence {
  return {
    solar_activity: 'unknown', geomagnetic_condition: 'QUIET', kp_index: 2.3,
    relevant_to_incident: false, explanation: 'Space-weather data unavailable; assumed quiet.',
    source_name: 'NOAA SWPC', source_url: 'https://services.swpc.noaa.gov/',
    retrieved_at: new Date().toISOString(), mode: 'OFFLINE_FIXTURE', cached: false, fallback_used: true,
  };
}
function defaultOrbit(baseline: number): OrbitEvidence {
  return {
    orbit_type: 'UNKNOWN', altitude_context: `Baseline ${baseline}km`, tle_summary: 'Unavailable',
    orbit_deviation_detected: false, relevant_to_incident: false,
    explanation: 'Orbit data unavailable; assumed nominal.',
    source_name: 'CelesTrak', source_url: 'https://celestrak.org/NORAD/elements/',
    retrieved_at: new Date().toISOString(), mode: 'OFFLINE_FIXTURE', cached: false, fallback_used: true,
  };
}
