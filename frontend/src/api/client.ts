// Typed API client. Uses same-origin /api (Vite proxies to the backend), so no
// CORS and no hardcoded host. Every method throws ApiError on non-2xx.
import type {
  AdapterStatus,
  AgentExecution,
  Alert,
  AuthUser,
  LoginResponse,
  DashboardSummary,
  Insight,
  Investigation,
  InvestigationDetail,
  Report,
  ReportSummary,
  Satellite,
  SatelliteStatusResult,
  SatelliteStatusEvent,
  SatelliteStatusMode,
  ManualSatelliteStatus,
  SimulationStatus,
  SimSatellite,
  SimSession,
  SimEvent,
  SimFieldKey,
  SimFieldConfig,
  SimTelemetryProfile,
  FailureCatalogEntry,
  SpaceWeather,
  Telemetry,
  Thresholds,
} from '../types';
import type {
  ObsRange, ObsSnapshot, ObsOverview, ObsGovernance, ObsTimeseries, ObsEvaluationResult,
} from '../lib/observability';
import type {
  ProvidersStatus, VerificationResult, ActiveSpaceInfo, ReindexResult, ComparisonRunResult,
} from '../lib/providers';

const BASE =
  import.meta.env.VITE_API_BASE_URL || "https://orion-backend-0bdi.onrender.com/api";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string>) {
    super(message);
  }
}

// --- Auth token wiring (set by AuthContext) ---
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    // A 401 on any call (other than login) means the session is gone/invalid —
    // trigger the logout/redirect flow registered by AuthContext.
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/login')) {
      onUnauthorized();
    }
    let message = `Request failed (${res.status})`;
    let details: Record<string, string> | undefined;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
      if (body.details && typeof body.details === 'object') details = body.details as Record<string, string>;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  health: () => request<{ status: string; integration_mode: string; simulation_running: boolean; satellites?: number; multi_agent_system?: string; mission_intelligence?: string }>('/health'),

  // Auth
  login: (username: string, password: string) => post<LoginResponse>('/auth/login', { username, password }),
  me: () => request<{ user: AuthUser }>('/auth/me'),
  logout: () => post<{ ok: boolean }>('/auth/logout'),

  // Dashboard
  dashboardSummary: () => request<DashboardSummary>('/dashboard/summary'),
  dashboardTelemetry: (satelliteId?: string, limit = 60) =>
    request<{ satellite_id: string; samples: Telemetry[] }>(
      `/dashboard/telemetry?limit=${limit}${satelliteId ? `&satellite_id=${satelliteId}` : ''}`,
    ),
  recentAlerts: () => request<Alert[]>('/dashboard/recent-alerts'),
  dashboardInvestigations: () => request<Investigation[]>('/dashboard/investigations'),
  insights: () => request<Insight[]>('/dashboard/insights'),
  spaceWeather: () => request<SpaceWeather>('/dashboard/space-weather'),

  // Satellites (read + dynamic onboarding)
  satellites: (includeArchived = false) => request<Satellite[]>(`/satellites${includeArchived ? '?includeArchived=true' : ''}`),
  satellite: (id: string) =>
    request<SatelliteDetail>(`/satellites/${id}`),
  satelliteTelemetry: (id: string, limit = 60) => request<Telemetry[]>(`/satellites/${id}/telemetry?limit=${limit}`),
  createSatellite: (input: SatelliteCreateInput) => post<Satellite>('/satellites', input),
  updateSatellite: (id: string, patchBody: Partial<SatelliteCreateInput>) => patch<Satellite>(`/satellites/${id}`, patchBody),
  archiveSatellite: (id: string) => post<Satellite>(`/satellites/${id}/archive`),
  reactivateSatellite: (id: string) => post<Satellite>(`/satellites/${id}/reactivate`),
  simulateSatellite: (id: string) => post<{ ok: boolean; message: string }>(`/satellites/${id}/simulate`),
  stopSimulateSatellite: (id: string) => post<{ ok: boolean; message: string }>(`/satellites/${id}/simulate/stop`),
  setSatelliteStatus: (id: string, body: { mode: SatelliteStatusMode; status?: ManualSatelliteStatus; reason?: string }) =>
    patch<SatelliteStatusResult>(`/satellites/${id}/status`, body),
  satelliteStatusHistory: (id: string, limit = 50) => request<SatelliteStatusEvent[]>(`/satellites/${id}/status/history?limit=${limit}`),

  // Telemetry
  telemetry: (satelliteId?: string, limit = 60) =>
    request<Telemetry[]>(`/telemetry?limit=${limit}${satelliteId ? `&satellite_id=${satelliteId}` : ''}`),

  // Alerts
  alerts: (params?: { status?: string; satellite_id?: string; anomaly_type?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request<Alert[]>(`/alerts${q ? `?${q}` : ''}`);
  },
  acknowledgeAlert: (id: number) => post<Alert>(`/alerts/${id}/acknowledge`),

  // Investigations
  investigations: () => request<Investigation[]>('/investigations'),
  investigation: (id: number) => request<InvestigationDetail>(`/investigations/${id}`),
  approve: (id: number) => post<Investigation>(`/investigations/${id}/approve`),
  reject: (id: number) => post<Investigation>(`/investigations/${id}/reject`),
  resolve: (id: number) => post<Investigation>(`/investigations/${id}/resolve`),
  rerunAnalysis: (id: number) => post<{ investigation: InvestigationDetail }>(`/investigations/${id}/rerun-analysis`),
  generateReport: (id: number) => post<Report>(`/investigations/${id}/generate-report`),

  // Agents
  agents: () => request<{ agent_id: string; name: string; description: string }[]>('/agents'),
  agentExecutions: (limit = 50) => request<AgentExecution[]>(`/agents/executions?limit=${limit}`),

  // Satellite Simulation Control Center (session-based, human-controlled)
  simulationStatus: () => request<SimulationStatus>('/simulation/status'),
  simSatellites: () => request<SimSatellite[]>('/simulation/satellites'),
  simFailureCatalog: () => request<FailureCatalogEntry[]>('/simulation/failures'),
  simSessions: () => request<SimSession[]>('/simulation/sessions'),
  simSession: (id: string) => request<SimSession>(`/simulation/sessions/${id}`),
  simCreateSession: (input: { satelliteId: string; telemetryProfile?: Partial<SimTelemetryProfile>; simulationSpeed?: number }) =>
    post<SimSession>('/simulation/sessions', input),
  simStart: (id: string) => post<SimSession>(`/simulation/sessions/${id}/start`),
  simPause: (id: string) => post<SimSession>(`/simulation/sessions/${id}/pause`),
  simResume: (id: string) => post<SimSession>(`/simulation/sessions/${id}/resume`),
  simStop: (id: string) => post<SimSession>(`/simulation/sessions/${id}/stop`),
  simUpdateConfig: (id: string, telemetryProfile: Partial<Record<SimFieldKey, Partial<SimFieldConfig>>>) =>
    patch<SimSession>(`/simulation/sessions/${id}/config`, { telemetryProfile }),
  simSetSpeed: (id: string, simulationSpeed: number) => patch<SimSession>(`/simulation/sessions/${id}/speed`, { simulationSpeed }),
  simInjectFailure: (id: string, spec: { failureType: string; severity?: string; onset?: string; recovery?: string; durationTicks?: number | null; onsetTicks?: number }) =>
    post<SimSession>(`/simulation/sessions/${id}/failures`, spec),
  simRemoveFailure: (id: string, failureId: string) => del<SimSession>(`/simulation/sessions/${id}/failures/${failureId}`),
  simClearFailures: (id: string) => del<{ cleared: number; session: SimSession }>(`/simulation/sessions/${id}/failures`),
  simTelemetry: (id: string, limit = 60) => request<Telemetry[]>(`/simulation/sessions/${id}/telemetry?limit=${limit}`),
  simEvents: (id: string, limit = 100) => request<SimEvent[]>(`/simulation/sessions/${id}/events?limit=${limit}`),

  // Integrations
  integrations: () => request<AdapterStatus>('/integrations/status'),

  // Reports
  reports: () => request<ReportSummary[]>('/reports'),
  report: (id: number) => request<Report>(`/reports/${id}`),

  // Settings
  thresholds: () => request<{ thresholds: Thresholds; defaults: Thresholds; integration_mode: string }>('/settings/thresholds'),
  updateThresholds: (t: Partial<Thresholds>) => put<{ thresholds: Thresholds }>('/settings/thresholds', t),
  resetThresholds: () => post<{ thresholds: Thresholds }>('/settings/thresholds/reset'),

  // Mission Copilot (Phase 5) — read-only conversational RAG
  copilotStatus: () => request<CopilotStatus>('/copilot/status'),
  copilotConversations: () => request<CopilotConversation[]>('/copilot/conversations'),
  copilotCreateConversation: (title?: string) => post<CopilotConversation>('/copilot/conversations', { title }),
  copilotConversation: (id: string) =>
    request<{ conversation: CopilotConversation; messages: CopilotMessage[] }>(`/copilot/conversations/${id}`),
  copilotSend: (id: string, message: string) => post<CopilotAnswer>(`/copilot/conversations/${id}/messages`, { message }),
  copilotArchive: (id: string) => post<{ ok: boolean }>(`/copilot/conversations/${id}/archive`),

  // AI Observability, Evaluation & Governance (Phase 8) — read-only, Director/Admin.
  obsStatus: () => request<ObsStatus>('/observability/status'),
  obsSnapshot: (range: ObsRange) => request<ObsSnapshot>(`/observability/snapshot?range=${range}`),
  obsOverview: (range: ObsRange) => request<ObsOverview>(`/observability/overview?range=${range}`),
  obsGovernance: (range: ObsRange) => request<ObsGovernance>(`/observability/governance?range=${range}`),
  obsEvaluations: () => request<{ latestByMode: ObsEvaluationResult[]; history: ObsEvaluationResult[]; bestNdcgMode: string | null }>('/observability/evaluations'),
  obsTimeseries: (metric: string, range: ObsRange) => request<ObsTimeseries>(`/observability/timeseries?metric=${encodeURIComponent(metric)}&range=${range}`),

  // Providers + live verification + re-embedding + evaluation (Phase 9) — Director/Admin, read-only + controlled.
  providersStatus: () => request<ProvidersStatus>('/providers/status'),
  providersCapabilities: () => request<Record<string, unknown>>('/providers/capabilities'),
  verifyLlmProvider: () => post<VerificationResult>('/providers/llm/verify'),
  verifyEmbeddingProvider: () => post<VerificationResult>('/providers/embeddings/verify'),
  providerVerifications: (limit = 20) => request<{ total: number; items: VerificationResult[] }>(`/providers/verifications?limit=${limit}`),
  embeddingSpaces: () => request<{ spaces: Record<string, unknown>[]; chunkSpaceStats: Record<string, unknown>[] }>('/providers/embedding-spaces'),
  activeEmbeddingSpace: () => request<ActiveSpaceInfo>('/providers/embedding-spaces/active'),
  reindexEmbeddings: () => post<ReindexResult>('/providers/embeddings/reindex'),
  reindexStatus: (id: number) => request<Record<string, unknown>>(`/providers/embeddings/reindex/${id}`),
  runProviderComparison: (maxScenarios?: number) => post<ComparisonRunResult>('/providers/evaluations/compare', maxScenarios ? { maxScenarios } : {}),
  providerComparisons: (limit = 10) => request<{ total: number; items: Record<string, unknown>[] }>(`/providers/evaluations?limit=${limit}`),

  // ORION AI Assistant (Phase 10) — read-only agentic chatbot.
  assistantStatus: () => request<AssistantStatus>('/assistant/status'),
  assistantCapabilities: () => request<AssistantCapabilityInfo[]>('/assistant/capabilities'),
  assistantConversations: () => request<CopilotConversation[]>('/assistant/conversations'),
  assistantCreateConversation: (title?: string) => post<CopilotConversation>('/assistant/conversations', { title }),
  assistantConversation: (id: string) => request<{ conversation: CopilotConversation; messages: AssistantHistoryMessage[] }>(`/assistant/conversations/${id}`),
  assistantSend: (id: string, message: string) => post<AssistantResult>(`/assistant/conversations/${id}/messages`, { message }),
  assistantArchive: (id: string) => post<{ ok: boolean }>(`/assistant/conversations/${id}/archive`),
  assistantCitation: (citationId: string) => request<AssistantSource>(`/assistant/citations/${encodeURIComponent(citationId)}`),
  assistantFeedback: (messageId: number, rating: 'THUMBS_UP' | 'THUMBS_DOWN', reason?: string, comment?: string) =>
    post<Record<string, unknown>>(`/assistant/messages/${messageId}/feedback`, { rating, ...(reason ? { reason } : {}), ...(comment ? { comment } : {}) }),
  assistantRunEvaluation: (maxScenarios?: number) => post<AssistantEvalSummary>('/assistant/evaluations/run', maxScenarios ? { maxScenarios } : {}),
  assistantEvaluations: () => request<Record<string, unknown>[]>('/assistant/evaluations'),
  assistantObservability: (range: ObsRange) => request<Record<string, unknown>>(`/assistant/observability?range=${range}`),
  /**
   * Stream an assistant turn via SSE (fetch reader — EventSource can't send the
   * auth header). Calls onProgress for each staged event and resolves with the
   * final result. Never surfaces hidden reasoning/prompts/vectors (server-bounded).
   */
  assistantStream: async (
    id: string,
    message: string,
    onProgress: (e: { type: string; detail?: string }) => void,
  ): Promise<AssistantResult> => {
    const res = await fetch(`${BASE}/assistant/conversations/${id}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({ message }),
    });
    if (!res.ok || !res.body) {
      if (res.status === 401 && onUnauthorized) onUnauthorized();
      throw new ApiError(res.status, `stream failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: AssistantResult | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const evLine = chunk.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!evLine || !dataLine) continue;
        const ev = evLine.slice(7).trim();
        let data: unknown = {};
        try { data = JSON.parse(dataLine.slice(6)); } catch { /* ignore */ }
        if (ev === 'progress') onProgress(data as { type: string; detail?: string });
        else if (ev === 'result') result = data as AssistantResult;
        else if (ev === 'error') throw new ApiError(500, (data as { message?: string }).message ?? 'stream error');
      }
    }
    if (!result) throw new ApiError(500, 'stream ended without a result');
    return result;
  },
};

export interface ObsStatus {
  read_only: boolean;
  config: Record<string, unknown>;
  llm_operating_mode: string;
  embedding_operating_mode: string;
  offline_mode: boolean;
  time_series_metrics: string[];
  time_ranges: string[];
}

// --- Mission Copilot types ---
export type CopilotAnswerStatus = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';
export interface CopilotConversation {
  id: string; user_id: string; role: string; title: string; status: string; created_at: string; updated_at: string;
}
export interface CopilotMessage {
  id: number; conversation_id: string; role: 'user' | 'assistant'; content: string; execution_mode: string | null; created_at: string;
}
export interface CopilotAnswer {
  conversationId: string; messageId: number | null; correlationId: string;
  executionMode: 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK'; status: CopilotAnswerStatus;
  answer: string;
  claims: { claim: string; citation_ids: string[]; evidence_ids: string[] }[];
  citations: { citationId: string; documentId: number; title: string }[];
  evidenceIds: string[]; limitations: string[]; suggestedFollowups: string[];
  toolActivity: { toolName: string; status: string; validationStatus: string; summary: string }[];
  diagnostics: { iterationCount: number; toolCallCount: number; claimCount: number; supportedClaimCount: number; groundingValid: boolean; policyValid: boolean; averageGroundingSupport: number | null; terminationReason: string };
  disclaimer: string;
}
export interface CopilotStatus {
  read_only: boolean;
  tools: { name: string; description: string; version: string }[];
  config: Record<string, number>;
}

// --- Dynamic satellite onboarding types ---
export interface SatelliteCreateInput {
  id: string;
  name?: string;
  mission: string;
  description?: string | null;
  orbit_type?: string | null;
  norad_catalog_id?: string | null;
  tle_line1?: string | null;
  tle_line2?: string | null;
  altitude?: number | null;
  velocity?: number | null;
  inclination?: number | null;
  orbital_period_min?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  launch_date?: string | null;
  sim_eligible?: boolean;
}
export interface SatelliteDetail extends Satellite {
  telemetry_state: 'NO_TELEMETRY' | 'SIMULATED' | 'EXTERNAL';
  has_telemetry: boolean;
  simulated: boolean;
  active_alerts: Alert[];
  investigations: Investigation[];
}

// --- ORION AI Assistant types (Phase 10) ---
export type AssistantExecutionMode = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';
export type AssistantExecutionStatus = 'ACCEPTED' | 'REAL_REJECTED' | 'DETERMINISTIC' | 'INSUFFICIENT_EVIDENCE' | 'REFUSED' | 'FAILED';

export interface AssistantRichContent { type: string; data: Record<string, unknown> }
export interface AssistantClaim { claim: string; citation_ids: string[]; evidence_ids: string[] }
export interface AssistantAnswer {
  answer_version: string; title: string; summary: string;
  sections: { heading: string; body: string }[];
  claims: AssistantClaim[]; citations: string[]; evidence_ids: string[];
  workflow_references: string[]; limitations: string[]; suggested_followups: string[];
  rich_content: AssistantRichContent[];
}
export interface AssistantCitation { citationId: string; documentId: number; title: string }
export interface AssistantWorkflowResult {
  workflow: string; status: string; executionMode: string; investigationId: number | null;
  plannerExecutionId: number | null; criticExecutionId: number | null; advisoryLabel: string;
  criticDecision?: string | null; humanReviewRequired: boolean; summary: string;
}
export interface AssistantToolResult { toolCallId: string; toolName: string; status: string; validationStatus: string; summary: string; latencyMs: number }
export interface AssistantResult {
  conversationId: string; messageId: number | null; correlationId: string;
  executionMode: AssistantExecutionMode; status: AssistantExecutionStatus;
  provider: string | null; model: string | null;
  answer: AssistantAnswer; citations: AssistantCitation[]; evidenceIds: string[];
  workflowResults: AssistantWorkflowResult[]; toolActivity: AssistantToolResult[];
  richContent: AssistantRichContent[]; suggestedFollowups: string[];
  context: Record<string, unknown>;
  diagnostics: {
    intent: string; capability: string | null; iterationCount: number; toolCallCount: number;
    retrievalCallCount: number; workflowCallCount: number; claimCount: number; supportedClaimCount: number;
    citationCount: number; evidenceCount: number; groundingValid: boolean; policyValid: boolean;
    averageGroundingSupport: number | null; contextResolved: boolean; terminationReason: string; qualityGate: string;
  };
  disclaimer: string;
}
export interface AssistantHistoryMessage extends CopilotMessage {
  execution_id?: number | null; status?: string | null; intent?: string | null; capability?: string | null;
  card?: AssistantAnswer | null;
}
export interface AssistantStatus {
  read_only: boolean; llm_operating_mode: string; embedding_operating_mode: string; offline_mode: boolean;
  config: Record<string, number>; tools: { name: string; description: string; version: string }[];
}
export interface AssistantCapabilityInfo {
  id: string; description: string; tools: string[]; workflows: string[];
  retrieval_required: boolean; deterministic_rca_required: boolean; required_roles: string[] | null;
  max_tool_calls: number; max_retrieval_calls: number; timeout_ms: number; output_type: string; grounding_required: boolean;
}
export interface AssistantSource {
  citationId: string; documentId: number; documentTitle: string; documentStableId: string | null;
  documentVersion: string | null; sourceType: string | null; provenanceOrigin: string | null;
  ingestedBy: string | null; ingestedAt: string | null; chunkIndex: number | null; excerpt: string;
  embeddingSpaceKey: string | null; embeddingProvider: string | null; embeddingModel: string | null;
}
export interface AssistantEvalSummary {
  evalRunId: number; datasetVersion: string; realProviderAvailable: boolean; scenarioCount: number;
  intentAccuracy: number; contextAccuracy: number; toolSelectionAccuracy: number; groundingAcceptedRate: number;
  refusalCorrectRate: number; realAcceptedRate: number; fallbackRate: number; failureRate: number;
  averageIterations: number; averageToolCalls: number; latencyP50Ms: number; latencyP95Ms: number;
  results: Record<string, unknown>[];
}
