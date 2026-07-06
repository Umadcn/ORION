// Frontend mirror of the backend response shapes (only what the UI consumes).

export type Role = 'MISSION_DIRECTOR' | 'MISSION_ANALYST' | 'SYSTEM_ADMIN';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  display_name: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export type SatelliteStatus = 'HEALTHY' | 'WARNING' | 'ALERT' | 'OFFLINE' | 'UNKNOWN';
export type SatelliteStatusMode = 'AUTO' | 'MANUAL';
export type ManualSatelliteStatus = 'HEALTHY' | 'WARNING' | 'ALERT';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type InvestigationStatus =
  | 'DETECTED'
  | 'ANALYZING'
  | 'WAITING_FOR_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESOLVED';
export type AgentStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'FALLBACK_USED';
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';

export type FailureType =
  | 'POWER_SYSTEM_FAILURE'
  | 'THERMAL_CONTROL_FAILURE'
  | 'COMMUNICATION_FAILURE'
  | 'ORBIT_DEVIATION'
  | 'BATTERY_DEGRADATION';

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
  // Dynamic-onboarding metadata (optional; older rows may omit).
  display_name?: string | null;
  description?: string | null;
  norad_catalog_id?: string | null;
  tle_line1?: string | null;
  tle_line2?: string | null;
  inclination?: number | null;
  orbital_period_min?: number | null;
  launch_date?: string | null;
  orbit_data_state?: 'REAL_EXTERNAL' | 'MANUALLY_PROVIDED' | 'UNAVAILABLE' | null;
  data_source_mode?: 'NO_TELEMETRY' | 'SIMULATED' | 'EXTERNAL' | null;
  sim_eligible?: number | null;
  lifecycle_state?: 'ACTIVE' | 'ARCHIVED' | null;
  origin?: 'SEED' | 'MANUAL' | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived_at?: string | null;
  // Manual status control. `status` above is the EFFECTIVE status; these expose both sides.
  status_mode?: SatelliteStatusMode | null;
  manual_status?: ManualSatelliteStatus | null;
  manual_status_reason?: string | null;
  manual_status_updated_at?: string | null;
  manual_status_updated_by?: string | null;
  derived_status?: SatelliteStatus;
  effective_status?: SatelliteStatus;
}

export interface SatelliteStatusResult {
  satelliteId: string;
  statusMode: SatelliteStatusMode;
  manualStatus: ManualSatelliteStatus | null;
  derivedStatus: SatelliteStatus;
  effectiveStatus: SatelliteStatus;
  manualStatusReason: string | null;
  manualStatusUpdatedAt: string | null;
  manualStatusUpdatedBy: string | null;
  satellite: Satellite;
}

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
  anomaly_type: string;
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
  detected_anomalies: string[];
  root_cause: string | null;
  confidence: number | null;
  severity: Severity | null;
  explanation: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  resolved_at: string | null;
  review_decision: 'APPROVED' | 'REJECTED' | null;
}

export interface Evidence {
  id: number;
  investigation_id: number;
  source_type: 'TELEMETRY' | 'ANOMALY_RULE' | 'SPACE_WEATHER' | 'ORBIT_DATA' | 'SYSTEM';
  source_name: string;
  summary: string;
  details: Record<string, unknown>;
  reliability_score: number;
  supports_root_cause: boolean;
  timestamp: string;
  source_url: string | null;
  mode: 'OFFLINE_FIXTURE' | 'LIVE_API' | null;
  cached: boolean;
  fallback_used: boolean;
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

export interface ScoringEntry {
  root_cause: string;
  raw_score: number;
  normalized: number;
  contributions: { factor: string; weight: number }[];
}

export interface InvestigationDetail extends Investigation {
  scoring_breakdown: ScoringEntry[];
  evidence: Evidence[];
  recommendations: Recommendation[];
  agent_executions: AgentExecution[];
  alerts: Alert[];
  report: { id: number } | null;
}

export interface DashboardSummary {
  total_satellites: number;
  healthy_satellites: number;
  healthy_percent: number;
  active_alerts: number;
  active_investigations: number;
  system_uptime_percent: number;
  system_health: 'OPERATIONAL' | 'DEGRADED';
  simulation_running: boolean;
  satellites: Satellite[];
}

export interface Insight {
  investigation_id: number;
  satellite_id: string;
  title: string;
  root_cause: string;
  confidence: number;
  severity: Severity;
  explanation: string;
  status: InvestigationStatus;
}

export interface SpaceWeather {
  kp_index: number;
  condition: string;
  label: string;
  solar_activity: string;
  commentary: string;
  mode: string;
  source_name: string;
  source_url: string;
}

export interface SimulationStatus {
  running: boolean;
  active_session_count: number;
  simulated_satellites: string[];
  sessions: { id: string; satellite_id: string; status: SimSessionStatus; tick_count: number; simulation_speed: number }[];
  active_failures: { session_id: string; satellite_id: string; failure_type: string; severity: string; state: string }[];
  recent_events: SimEvent[];
}

// ---------- Satellite Simulation Control Center ----------

export type SimSessionStatus = 'CREATED' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'INTERRUPTED' | 'FAILED';
export type SimFailureState = 'ACTIVE' | 'EXPIRED' | 'REMOVED';
export type SimFieldKey = 'battery_percent' | 'temperature_c' | 'power_consumption_w' | 'signal_strength_dbm' | 'altitude_km';

export interface SimFieldConfig {
  baseline: number;
  min: number;
  max: number;
  noise: number;
  drift: number;
}
export type SimTelemetryProfile = Record<SimFieldKey, SimFieldConfig>;

export interface SimFailure {
  id: string;
  failure_type: string;
  display_name: string;
  severity: Severity;
  onset: 'IMMEDIATE' | 'GRADUAL';
  recovery: 'IMMEDIATE' | 'LINEAR' | 'GRADUAL';
  duration_ticks: number | null;
  remaining_ticks: number | null;
  onset_ticks: number;
  state: SimFailureState;
  injected_at_tick: number;
  expired_at_tick: number | null;
  affected_fields: SimFieldKey[];
  expected_alert_types: string[];
}

export interface SimSession {
  id: string;
  satellite_id: string;
  satellite_name: string;
  status: SimSessionStatus;
  telemetry_profile: SimTelemetryProfile;
  tick_interval_ms: number;
  simulation_speed: number;
  tick_count: number;
  telemetry_source: 'SIMULATED';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  paused_at: string | null;
  stopped_at: string | null;
  active_failures: number;
  failures: SimFailure[];
}

export interface SimSatellite {
  id: string;
  name: string;
  mission: string;
  status: SatelliteStatus;
  orbit_type: string;
  data_source_mode: string;
  origin: string;
  session_id: string | null;
  session_status: SimSessionStatus | null;
  telemetry_sample_count: number;
  active_alerts: number;
  open_investigations: number;
}

export interface FailureCatalogEntry {
  failureType: string;
  displayName: string;
  description: string;
  affectedTelemetryFields: SimFieldKey[];
  supportedSeverityLevels: Severity[];
  defaultSeverity: Severity;
  supportsDuration: boolean;
  supportsGradualOnset: boolean;
  supportsManualRemoval: boolean;
  anomalyRulesTriggered: string[];
  expectedAlertTypes: string[];
  precedence: number;
}

export interface SimEvent {
  id: number;
  session_id: string | null;
  satellite_id: string | null;
  event_type: string;
  summary: string;
  actor: string | null;
  created_at: string;
}

export interface Thresholds {
  high_temperature_c: number;
  low_battery_percent: number;
  comm_loss_dbm: number;
  abnormal_power_w: number;
  orbit_deviation_km: number;
  min_persisted_samples: number;
}

export interface AdapterStatus {
  integration_mode: string;
  live_mode_enabled: boolean;
  adapters: {
    name: string;
    purpose: string;
    source_url: string;
    mode: string;
    cached: boolean;
    fallback_used: boolean;
    sample: Record<string, unknown>;
  }[];
}

// ---- Professional structured report sections (additive; older reports omit) ----
export type ReportMetricStatus = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export interface ReportTelemetryMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  expected: string | null;
  status: ReportMetricStatus;
}
export interface ReportAnomalyRow {
  index: number;
  anomaly_type: string;
  metric: string;
  observed_value: string;
  expected: string;
  severity: string;
  detection_time: string | null;
  status: string;
  evidence: string | null;
}
export interface ReportEvidenceRow {
  id: string;
  type: string;
  source: string;
  observation: string;
  weight: number;
  supports: boolean;
  timestamp: string;
}
export interface ReportRca {
  primary_root_cause: string | null;
  confidence: number | null;
  severity: string | null;
  status: string;
  reasoning: string[];
  contributing_factors: { factor: string; weight: number }[];
  evidence_distribution: { root_cause: string; normalized: number }[];
  supporting_evidence: ReportEvidenceRow[];
  alternative_hypotheses: { hypothesis: string; confidence: number; note: string }[];
}
export interface ReportAgentDetail {
  agent_id: string;
  agent_name: string;
  purpose: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  output_summary: string;
  confidence: number | null;
}
export interface ReportAuditRow {
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  result: string;
}
export interface ReportRiskRow {
  category: string;
  likelihood: string;
  impact: string;
  level: string;
  mitigation: string;
}
export interface ReportSystemTransparency {
  analysis_mode: string;
  rca_engine_version: string;
  ruleset_version: string;
  report_generator_version: string;
  llm_provider: string;
  llm_model: string | null;
  fallback_mode_used: boolean;
  grounding_status: string;
  human_review_required: boolean;
}
export interface ReportCompleteness {
  score: number;
  max: number;
  categories: { key: string; label: string; score: number; max: number }[];
}
export interface ReportReview {
  status: string;
  reviewed_by: string;
  review_date: string | null;
  decision: string;
  notes: string;
}
export interface ReportExecutiveSummary {
  primary_finding: string;
  detected_condition: string;
  operational_impact: string;
  current_status: string;
  required_human_action: string;
}

export interface ReportContent {
  title: string;
  generated_at: string;
  safety_statement: string;
  incident_summary: string;
  satellite: { id: string; name: string; mission: string; orbit_type: string; norad_id: string };
  timeline: { time: string; event: string }[];
  detected_anomalies: string[];
  telemetry_evidence: { summary: string; source_name: string }[];
  space_weather_evidence: Evidence | null;
  orbit_evidence: Evidence | null;
  agent_execution_history: { agent_name: string; status: string; duration_ms: number | null; output_summary: string }[];
  root_cause: string | null;
  confidence: number | null;
  severity: string | null;
  explanation: string | null;
  scoring_breakdown: ScoringEntry[];
  recommendations: { action: string; rationale: string; priority: string }[];
  mission_director_decision: string;
  reviewed_at: string | null;
  resolution: string;
  resolved_at: string | null;
  references: { title: string; host_venue: string; publication_year: number }[];
  provenance: { source_name: string; source_url: string; mode: string; cached: boolean; fallback_used: boolean }[];

  // Professional structured sections — present on reports generated by the v2
  // report generator; optional so pre-existing reports still type-check.
  investigation_id?: number;
  report_status?: string;
  classification?: string;
  satellite_health?: number | null;
  detection_time?: string | null;
  investigation_started_at?: string;
  investigation_completed_at?: string | null;
  executive_summary?: ReportExecutiveSummary;
  telemetry_snapshot?: ReportTelemetryMetric[];
  telemetry_snapshot_time?: string | null;
  anomalies_detail?: ReportAnomalyRow[];
  rca?: ReportRca;
  agents_detail?: ReportAgentDetail[];
  decision_trace?: string[];
  risk_assessment?: ReportRiskRow[];
  audit_trail?: ReportAuditRow[];
  system_transparency?: ReportSystemTransparency;
  completeness?: ReportCompleteness;
  review?: ReportReview;
}

export interface Report {
  id: number;
  investigation_id: number;
  title: string;
  created_at: string;
  content: ReportContent;
}

export interface ReportSummary {
  id: number;
  investigation_id: number;
  title: string;
  created_at: string;
  satellite_id: string | null;
  root_cause: string | null;
  confidence: number | null;
  severity: Severity | null;
  investigation_status: InvestigationStatus | null;
}
