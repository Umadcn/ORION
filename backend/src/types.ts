/**
 * Shared TypeScript types for Project ORION.
 * These mirror the database rows and the typed agent inputs/outputs.
 */

// ---------- Enumerations ----------

// UNKNOWN = a manually-registered satellite with no telemetry yet (honest: health is not yet known).
export type SatelliteStatus = 'HEALTHY' | 'WARNING' | 'ALERT' | 'OFFLINE' | 'UNKNOWN';

// Manual status control. AUTO = use the system-derived status; MANUAL = operator
// override. Operators may only select the three canonical operational states.
export type SatelliteStatusMode = 'AUTO' | 'MANUAL';
export type ManualSatelliteStatus = 'HEALTHY' | 'WARNING' | 'ALERT';

export type OrbitDataState = 'REAL_EXTERNAL' | 'MANUALLY_PROVIDED' | 'UNAVAILABLE';
export type DataSourceMode = 'NO_TELEMETRY' | 'SIMULATED' | 'EXTERNAL';
export type SatelliteLifecycleState = 'ACTIVE' | 'ARCHIVED';
export type SatelliteOrigin = 'SEED' | 'MANUAL';

export type AnomalyType =
  | 'HIGH_TEMPERATURE'
  | 'LOW_BATTERY'
  | 'COMMUNICATION_LOSS'
  | 'ABNORMAL_POWER_CONSUMPTION'
  | 'ORBIT_DEVIATION';

export type FailureType =
  | 'POWER_SYSTEM_FAILURE'
  | 'THERMAL_CONTROL_FAILURE'
  | 'COMMUNICATION_FAILURE'
  | 'ORBIT_DEVIATION'
  | 'BATTERY_DEGRADATION';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';

export type InvestigationStatus =
  | 'DETECTED'
  | 'ANALYZING'
  | 'WAITING_FOR_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESOLVED';

export type ReviewDecision = 'APPROVED' | 'REJECTED' | null;

export type AgentStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FALLBACK_USED';

export type EvidenceSourceType =
  | 'TELEMETRY'
  | 'ANOMALY_RULE'
  | 'SPACE_WEATHER'
  | 'ORBIT_DATA'
  | 'SYSTEM';

export type RootCause =
  | 'PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION'
  | 'BATTERY_DEGRADATION'
  | 'THERMAL_CONTROL_FAILURE'
  | 'COMMUNICATION_SUBSYSTEM_FAILURE'
  | 'SPACE_WEATHER_INTERFERENCE'
  | 'ORBITAL_PERTURBATION'
  | 'UNKNOWN_ANOMALY';

export type IntegrationMode = 'OFFLINE_FIXTURE' | 'LIVE_API';

// ---------- Database row shapes ----------

export interface Satellite {
  id: string;
  name: string;
  norad_id: string;
  mission: string;
  orbit_type: string;
  altitude: number;
  velocity: number;
  latitude: number;
  longitude: number;
  health_score: number;
  status: SatelliteStatus;
  // Dynamic-onboarding fields (nullable for backward compatibility with pre-existing rows).
  display_name?: string | null;
  description?: string | null;
  norad_catalog_id?: string | null;
  tle_line1?: string | null;
  tle_line2?: string | null;
  inclination?: number | null;
  orbital_period_min?: number | null;
  launch_date?: string | null;
  orbit_data_state?: OrbitDataState | null;
  data_source_mode?: DataSourceMode | null;
  sim_eligible?: number | null;
  lifecycle_state?: SatelliteLifecycleState | null;
  origin?: SatelliteOrigin | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
  // Manual status control (persisted columns).
  status_mode?: SatelliteStatusMode | null;
  manual_status?: ManualSatelliteStatus | null;
  manual_status_reason?: string | null;
  manual_status_updated_at?: string | null;
  manual_status_updated_by?: string | null;
  // Computed by serializeSatellite() (not stored). `status` above is set to the
  // effective status on serialized rows; these expose both sides explicitly.
  derived_status?: SatelliteStatus;
  effective_status?: SatelliteStatus;
}

/** One immutable manual-status change audit record. */
export interface SatelliteStatusEvent {
  id: number;
  satellite_id: string;
  previous_mode: SatelliteStatusMode | null;
  previous_manual_status: ManualSatelliteStatus | null;
  previous_effective_status: SatelliteStatus | null;
  new_mode: SatelliteStatusMode;
  new_manual_status: ManualSatelliteStatus | null;
  new_effective_status: SatelliteStatus;
  reason: string | null;
  actor: string;
  actor_role: string | null;
  created_at: string;
}

export interface Telemetry {
  id: number;
  satellite_id: string;
  timestamp: string;
  temperature_c: number;
  battery_percent: number;
  signal_strength_dbm: number;
  power_consumption_w: number;
  altitude_km: number;
  velocity_kms: number;
  latitude: number;
  longitude: number;
}

export interface Alert {
  id: number;
  satellite_id: string;
  anomaly_type: AnomalyType;
  severity: Severity;
  message: string;
  status: AlertStatus;
  investigation_id: number | null;
  created_at: string;
}

export interface Investigation {
  id: number;
  title: string;
  satellite_id: string;
  status: InvestigationStatus;
  priority: Severity;
  detected_anomalies: string; // JSON array
  root_cause: RootCause | null;
  confidence: number | null;
  severity: Severity | null;
  explanation: string | null;
  scoring_breakdown: string | null; // JSON
  review_decision: ReviewDecision;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  resolved_at: string | null;
}

export interface Evidence {
  id: number;
  investigation_id: number;
  source_type: EvidenceSourceType;
  source_name: string;
  summary: string;
  details: string; // JSON
  reliability_score: number;
  supports_root_cause: number; // 0/1
  timestamp: string;
  source_url: string | null;
  mode: IntegrationMode | null;
  cached: number; // 0/1
  fallback_used: number; // 0/1
}

export interface Recommendation {
  id: number;
  investigation_id: number;
  action: string;
  rationale: string;
  priority: Severity;
}

export interface AgentExecution {
  id: number;
  investigation_id: number;
  agent_id: string;
  agent_name: string;
  status: AgentStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  input_summary: string;
  output_summary: string;
  error_message: string | null;
}

export interface Report {
  id: number;
  investigation_id: number;
  title: string;
  content: string; // JSON structured report
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
  updated_at: string;
}

// ---------- Agent I/O contracts ----------

export interface Trend {
  direction: 'RISING' | 'FALLING' | 'STABLE';
  delta: number;
  ratePerMin: number;
}

export interface TelemetryObservation {
  satellite_id: string;
  sample_count: number;
  latest_values: {
    temperature_c: number;
    battery_percent: number;
    signal_strength_dbm: number;
    power_consumption_w: number;
    altitude_km: number;
  };
  battery_trend: Trend;
  temperature_trend: Trend;
  power_trend: Trend;
  signal_trend: Trend;
  altitude_deviation: number;
  health_score: number;
  threshold_violations: ThresholdViolation[];
  observation_summary: string;
}

export interface ThresholdViolation {
  metric: string;
  anomaly_type: AnomalyType;
  value: number;
  threshold: number;
  samples_violating: number;
}

export interface DetectedAnomaly {
  type: AnomalyType;
  severity: Severity;
  value: number;
  threshold: number;
  persisted_samples: number;
  description: string;
}

export interface AnomalyDetectionResult {
  detected_anomalies: DetectedAnomaly[];
  severity: Severity;
  evidence: string[];
  summary: string;
}

export interface Provenance {
  source_name: string;
  source_url: string;
  retrieved_at: string;
  mode: IntegrationMode;
  cached: boolean;
  fallback_used: boolean;
}

export interface SpaceWeatherEvidence extends Provenance {
  solar_activity: string;
  geomagnetic_condition: string;
  kp_index: number;
  relevant_to_incident: boolean;
  explanation: string;
}

export interface OrbitEvidence extends Provenance {
  orbit_type: string;
  altitude_context: string;
  tle_summary: string;
  orbit_deviation_detected: boolean;
  relevant_to_incident: boolean;
  explanation: string;
}

export interface ScoringEntry {
  root_cause: RootCause;
  raw_score: number;
  normalized: number;
  contributions: { factor: string; weight: number }[];
}

export interface RootCauseAnalysisResult {
  root_cause: RootCause;
  confidence: number;
  severity: Severity;
  explanation: string;
  supporting_evidence: string[];
  contradicting_evidence: string[];
  recommended_actions: { action: string; rationale: string; priority: Severity }[];
  scoring_breakdown: ScoringEntry[];
}

export interface InvestigationEvidenceBundle {
  observation: TelemetryObservation;
  anomalies: AnomalyDetectionResult;
  spaceWeather: SpaceWeatherEvidence;
  orbit: OrbitEvidence;
}
