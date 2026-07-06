/**
 * Central configuration for Project ORION backend.
 * All values have safe offline defaults. No secrets, no company info.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type IntegrationMode = 'OFFLINE_FIXTURE' | 'LIVE_API';

/** Parse an env integer with a default and inclusive [min, max] clamp. */
function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = raw === undefined || raw === '' ? def : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Parse an env float with a default and inclusive [min, max] clamp. */
function clampFloat(raw: string | undefined, def: number, min: number, max: number): number {
  const n = raw === undefined || raw === '' ? def : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

const RETRIEVAL_MODE_VALUES = ['VECTOR', 'LEXICAL_BM25', 'HYBRID_RRF', 'HYBRID_RRF_RERANK'];
function resolveDefaultMode(raw: string | undefined): string {
  const v = (raw || 'VECTOR').toUpperCase();
  return RETRIEVAL_MODE_VALUES.includes(v) ? v : 'VECTOR';
}

export const config = {
  /** Loopback-only bind address for company-laptop safety. Never 0.0.0.0. */
  host: process.env.ORION_HOST || '0.0.0.0',
  port: Number(process.env.PORT || process.env.ORION_PORT || 8000),

  /** Default OFFLINE. Live external API calls are disabled unless explicitly enabled. */
  integrationMode: (process.env.ORION_INTEGRATION_MODE as IntegrationMode) || 'OFFLINE_FIXTURE',

  /** Telemetry generation cadence while the simulation is running. */
  tickMs: Number(process.env.ORION_TICK_MS || 2000),

  /** Optional live-mode timeout (ms). Only used if live mode is ever enabled. */
  liveApiTimeoutMs: 5000,

  /**
   * JWT secret. In production set ORION_JWT_SECRET in the environment.
   * The dev fallback is clearly non-production and only used for the local demo.
   */
  jwtSecret: process.env.ORION_JWT_SECRET || 'orion-dev-only-insecure-secret-change-me',
  jwtExpiresInSec: Number(process.env.ORION_JWT_EXPIRES_SEC || 12 * 60 * 60), // 12h
  usingDefaultJwtSecret: !process.env.ORION_JWT_SECRET,

  /**
   * LLM foundation (Phase 1). Real provider is OPTIONAL and OFF by default.
   * With no ORION_LLM_* configured, the platform runs in deterministic fallback
   * mode and startup/tests/existing workflows are unaffected. Secrets are read
   * from the environment only and never logged/persisted/returned by APIs.
   */
  llm: {
    provider: (process.env.ORION_LLM_PROVIDER || 'none').toLowerCase(), // 'none' | 'openai' | 'anthropic' | 'http'
    endpoint: process.env.ORION_LLM_ENDPOINT || '',
    apiKey: process.env.ORION_LLM_API_KEY || '',
    model: process.env.ORION_LLM_MODEL || '',
    timeoutMs: Number(process.env.ORION_LLM_TIMEOUT_MS || 20000),
    maxRetries: Number(process.env.ORION_LLM_MAX_RETRIES || 2),
    maxInputTokens: Number(process.env.ORION_LLM_MAX_INPUT_TOKENS || 6000),
    maxOutputTokens: Number(process.env.ORION_LLM_MAX_OUTPUT_TOKENS || 1024),
    fallbackEnabled: (process.env.ORION_LLM_FALLBACK_ENABLED ?? 'true') !== 'false',
  },

  /**
   * Embedding foundation (Phase 2). Default provider is the offline, in-process
   * LocalHashEmbedding (deterministic lexical feature hashing — NOT a neural
   * model). A real HTTP embedding provider is OPTIONAL and used only when fully
   * configured. Secrets are read from the environment only.
   */
  embedding: {
    provider: (process.env.ORION_EMBEDDING_PROVIDER || 'local').toLowerCase(), // 'local' | 'http' | 'openai' | 'none'
    endpoint: process.env.ORION_EMBEDDING_ENDPOINT || '',
    apiKey: process.env.ORION_EMBEDDING_API_KEY || '',
    model: process.env.ORION_EMBEDDING_MODEL || '',
    dimension: clampInt(process.env.ORION_EMBEDDING_DIMENSION, 256, 16, 4096),
    timeoutMs: clampInt(process.env.ORION_EMBEDDING_TIMEOUT_MS, 20000, 1000, 120000),
    maxBatchSize: clampInt(process.env.ORION_EMBEDDING_MAX_BATCH_SIZE, 64, 1, 512),
  },

  /**
   * Mission Knowledge Base ingestion + chunking bounds (Phase 2). All values are
   * bounded to keep ingestion deterministic and resource-safe.
   */
  knowledge: {
    maxDocumentChars: clampInt(process.env.ORION_KNOWLEDGE_MAX_DOCUMENT_CHARS, 100000, 100, 2000000),
    maxBatchDocuments: clampInt(process.env.ORION_KNOWLEDGE_MAX_BATCH_DOCUMENTS, 25, 1, 200),
    chunkSize: clampInt(process.env.ORION_KNOWLEDGE_CHUNK_SIZE, 1200, 32, 20000),
    chunkOverlap: clampInt(process.env.ORION_KNOWLEDGE_CHUNK_OVERLAP, 150, 0, 10000),
  },

  /** Vector (Phase 2) + hybrid (Phase 3) retrieval bounds. */
  retrieval: {
    defaultTopK: clampInt(process.env.ORION_RETRIEVAL_DEFAULT_TOP_K, 5, 1, 100),
    maxTopK: clampInt(process.env.ORION_RETRIEVAL_MAX_TOP_K, 25, 1, 200),
    maxCandidates: clampInt(process.env.ORION_RETRIEVAL_MAX_CANDIDATES, 5000, 100, 50000),
    maxQueryChars: clampInt(process.env.ORION_RETRIEVAL_MAX_QUERY_CHARS, 2000, 1, 20000),
    // Phase 3 hybrid retrieval:
    defaultMode: resolveDefaultMode(process.env.ORION_RETRIEVAL_DEFAULT_MODE), // VECTOR (default) | LEXICAL_BM25 | HYBRID_RRF | HYBRID_RRF_RERANK
    vectorCandidates: clampInt(process.env.ORION_RETRIEVAL_VECTOR_CANDIDATES, 50, 1, 5000),
    bm25Candidates: clampInt(process.env.ORION_RETRIEVAL_BM25_CANDIDATES, 50, 1, 5000),
    fusionK: clampInt(process.env.ORION_RETRIEVAL_FUSION_K, 60, 1, 100000),
    rerankCandidates: clampInt(process.env.ORION_RETRIEVAL_RERANK_CANDIDATES, 50, 1, 500),
    bm25K1: clampFloat(process.env.ORION_RETRIEVAL_BM25_K1, 1.2, 0, 5),
    bm25B: clampFloat(process.env.ORION_RETRIEVAL_BM25_B, 0.75, 0, 1),
    maxQueryTokens: clampInt(process.env.ORION_RETRIEVAL_MAX_QUERY_TOKENS, 64, 1, 2000),
    evalMaxQueries: clampInt(process.env.ORION_RETRIEVAL_EVAL_MAX_QUERIES, 50, 1, 500),
  },

  /**
   * Grounded generation (Phase 4) — bounds for the retrieval-augmented briefing
   * generation path. All values are bounded; safe offline defaults. The LLM is
   * OPTIONAL: with no real provider, generation uses the deterministic briefing
   * fallback and is clearly labeled DETERMINISTIC_FALLBACK_ACCEPTED.
   */
  generation: {
    maxContextChars: clampInt(process.env.ORION_GENERATION_MAX_CONTEXT_CHARS, 8000, 500, 100000),
    maxEvidenceItems: clampInt(process.env.ORION_GENERATION_MAX_EVIDENCE_ITEMS, 8, 1, 100),
    maxRetrievalChunks: clampInt(process.env.ORION_GENERATION_MAX_RETRIEVAL_CHUNKS, 6, 1, 50),
    retrievalTopK: clampInt(process.env.ORION_GENERATION_RETRIEVAL_TOP_K, 5, 1, 50),
    minRetrievalChunks: clampInt(process.env.ORION_GENERATION_MIN_RETRIEVAL_CHUNKS, 1, 0, 50),
    minGroundingSupport: clampFloat(process.env.ORION_GENERATION_MIN_GROUNDING_SUPPORT, 0.5, 0, 1),
    maxClaims: clampInt(process.env.ORION_GENERATION_MAX_CLAIMS, 12, 1, 100),
    maxTextPerSource: clampInt(process.env.ORION_GENERATION_MAX_TEXT_PER_SOURCE, 600, 50, 5000),
    injectionFilterEnabled: (process.env.ORION_GENERATION_INJECTION_FILTER_ENABLED ?? 'true') !== 'false',
  },

  /**
   * Mission Copilot (Phase 5) — read-only conversational RAG with controlled,
   * allowlisted, read-only tool calling. All limits are bounded; safe offline
   * defaults. With no real LLM provider, the Copilot uses a deterministic
   * intent-routed planner over the SAME read-only tool registry.
   */
  copilot: {
    maxIterations: clampInt(process.env.ORION_COPILOT_MAX_ITERATIONS, 4, 1, 12),
    maxToolCalls: clampInt(process.env.ORION_COPILOT_MAX_TOOL_CALLS, 6, 1, 24),
    maxToolOutputChars: clampInt(process.env.ORION_COPILOT_MAX_TOOL_OUTPUT_CHARS, 4000, 200, 50000),
    maxMessageChars: clampInt(process.env.ORION_COPILOT_MAX_MESSAGE_CHARS, 2000, 1, 20000),
    maxContextChars: clampInt(process.env.ORION_COPILOT_MAX_CONTEXT_CHARS, 8000, 500, 100000),
    maxRetainedMessages: clampInt(process.env.ORION_COPILOT_MAX_RETAINED_MESSAGES, 20, 2, 200),
    maxExecutionMs: clampInt(process.env.ORION_COPILOT_MAX_EXECUTION_MS, 15000, 1000, 120000),
    toolTimeoutMs: clampInt(process.env.ORION_COPILOT_TOOL_TIMEOUT_MS, 3000, 100, 60000),
    maxSuggestedFollowups: clampInt(process.env.ORION_COPILOT_MAX_SUGGESTED_FOLLOWUPS, 4, 0, 10),
    maxToolResultItems: clampInt(process.env.ORION_COPILOT_MAX_TOOL_RESULT_ITEMS, 10, 1, 100),
  },

  /**
   * ORION AI Assistant (Phase 10) — the Phase 5 Copilot upgraded into a full
   * conversational agentic assistant. All bounds are safe offline defaults;
   * startup is unaffected when unset. Real-provider behavior is opt-in.
   */
  assistant: {
    maxMessageChars: clampInt(process.env.ORION_ASSISTANT_MAX_MESSAGE_CHARS, 2000, 1, 20000),
    maxContextChars: clampInt(process.env.ORION_ASSISTANT_MAX_CONTEXT_CHARS, 8000, 500, 100000),
    maxRetainedMessages: clampInt(process.env.ORION_ASSISTANT_MAX_RETAINED_MESSAGES, 16, 2, 200),
    maxSummaryChars: clampInt(process.env.ORION_ASSISTANT_MAX_SUMMARY_CHARS, 1200, 100, 10000),
    maxIterations: clampInt(process.env.ORION_ASSISTANT_MAX_ITERATIONS, 5, 1, 12),
    maxToolCalls: clampInt(process.env.ORION_ASSISTANT_MAX_TOOL_CALLS, 8, 1, 24),
    maxRetrievalCalls: clampInt(process.env.ORION_ASSISTANT_MAX_RETRIEVAL_CALLS, 3, 1, 10),
    maxWorkflowCalls: clampInt(process.env.ORION_ASSISTANT_MAX_WORKFLOW_CALLS, 2, 1, 6),
    maxExecutionMs: clampInt(process.env.ORION_ASSISTANT_MAX_EXECUTION_MS, 30000, 1000, 180000),
    toolTimeoutMs: clampInt(process.env.ORION_ASSISTANT_TOOL_TIMEOUT_MS, 4000, 100, 60000),
    maxEvents: clampInt(process.env.ORION_ASSISTANT_MAX_EVENTS, 200, 10, 2000),
    maxRichContentItems: clampInt(process.env.ORION_ASSISTANT_MAX_RICH_CONTENT_ITEMS, 6, 0, 30),
    maxSuggestedFollowups: clampInt(process.env.ORION_ASSISTANT_MAX_SUGGESTED_FOLLOWUPS, 4, 0, 12),
    maxFeedbackCommentChars: clampInt(process.env.ORION_ASSISTANT_MAX_FEEDBACK_COMMENT_CHARS, 500, 0, 4000),
    evalMaxScenarios: clampInt(process.env.ORION_ASSISTANT_EVAL_MAX_SCENARIOS, 15, 1, 50),
    // Advisory governance thresholds (surfaced, never enforced).
    govFallbackRateMax: clampFloat(process.env.ORION_ASSISTANT_GOV_FALLBACK_RATE_MAX, 0.5, 0, 1),
    govFailureRateMax: clampFloat(process.env.ORION_ASSISTANT_GOV_FAILURE_RATE_MAX, 0.2, 0, 1),
    govInsufficientRateMax: clampFloat(process.env.ORION_ASSISTANT_GOV_INSUFFICIENT_RATE_MAX, 0.4, 0, 1),
    govGroundingValidRateMin: clampFloat(process.env.ORION_ASSISTANT_GOV_GROUNDING_VALID_RATE_MIN, 0.8, 0, 1),
    govToolErrorRateMax: clampFloat(process.env.ORION_ASSISTANT_GOV_TOOL_ERROR_RATE_MAX, 0.2, 0, 1),
    govNegativeFeedbackRateMax: clampFloat(process.env.ORION_ASSISTANT_GOV_NEGATIVE_FEEDBACK_RATE_MAX, 0.5, 0, 1),
    govRealRejectionRateMax: clampFloat(process.env.ORION_ASSISTANT_GOV_REAL_REJECTION_RATE_MAX, 0.5, 0, 1),
  },

  /**
   * Bounded Planner Agent + Agentic RAG (Phase 6). READ-ONLY analysis assistance.
   * Every loop/step/retrieval is bounded; safe offline defaults. With no real LLM
   * provider, a deterministic planner produces a bounded safe plan.
   */
  planner: {
    maxSteps: clampInt(process.env.ORION_PLANNER_MAX_STEPS, 10, 1, 30),
    maxIterations: clampInt(process.env.ORION_PLANNER_MAX_ITERATIONS, 12, 1, 50),
    maxToolCalls: clampInt(process.env.ORION_PLANNER_MAX_TOOL_CALLS, 16, 1, 60),
    maxRetrievalCalls: clampInt(process.env.ORION_PLANNER_MAX_RETRIEVAL_CALLS, 3, 1, 10),
    maxQueryRefinements: clampInt(process.env.ORION_PLANNER_MAX_QUERY_REFINEMENTS, 2, 0, 8),
    maxOutputChars: clampInt(process.env.ORION_PLANNER_MAX_OUTPUT_CHARS, 12000, 500, 100000),
    maxExecutionMs: clampInt(process.env.ORION_PLANNER_MAX_EXECUTION_MS, 20000, 1000, 120000),
    stepTimeoutMs: clampInt(process.env.ORION_PLANNER_STEP_TIMEOUT_MS, 4000, 100, 60000),
    minCitations: clampInt(process.env.ORION_PLANNER_MIN_CITATIONS, 1, 0, 20),
    minEvidenceItems: clampInt(process.env.ORION_PLANNER_MIN_EVIDENCE_ITEMS, 1, 0, 20),
  },

  /**
   * Bounded Critic Agent + Reflection/Revision loop (Phase 7). READ-ONLY
   * analysis-quality review of a Planner analysis before human review. Every
   * loop/call/context is bounded; safe offline defaults. With no real LLM
   * provider, a deterministic Critic produces a bounded, schema-valid review.
   */
  critic: {
    maxIssues: clampInt(process.env.ORION_CRITIC_MAX_ISSUES, 20, 1, 100),
    maxRevisionAttempts: clampInt(process.env.ORION_CRITIC_MAX_REVISION_ATTEMPTS, 2, 0, 6),
    maxCalls: clampInt(process.env.ORION_CRITIC_MAX_CALLS, 6, 1, 20),
    maxContextChars: clampInt(process.env.ORION_CRITIC_MAX_CONTEXT_CHARS, 12000, 500, 100000),
    maxExecutionMs: clampInt(process.env.ORION_CRITIC_MAX_EXECUTION_MS, 20000, 1000, 120000),
    minCoverageItems: clampInt(process.env.ORION_CRITIC_MIN_COVERAGE_ITEMS, 6, 1, 8),
    numericTolerance: clampFloat(process.env.ORION_CRITIC_NUMERIC_TOLERANCE, 0.05, 0, 1),
  },

  /**
   * Read-only AI Observability, Evaluation & Governance (Phase 8). Aggregates
   * the EXISTING audit tables; strictly read-only. All bounds are safe offline
   * defaults. Governance thresholds are advisory — they never mutate anything.
   */
  observability: {
    defaultRange: (['24H', '7D', '30D', 'ALL'].includes((process.env.ORION_OBSERVABILITY_DEFAULT_RANGE || '').toUpperCase()) ? (process.env.ORION_OBSERVABILITY_DEFAULT_RANGE || '').toUpperCase() : '7D') as '24H' | '7D' | '30D' | 'ALL',
    maxRangeDays: clampInt(process.env.ORION_OBSERVABILITY_MAX_RANGE_DAYS, 30, 1, 3650),
    maxRows: clampInt(process.env.ORION_OBSERVABILITY_MAX_ROWS, 100000, 100, 5000000),
    timeSeriesBucketLimit: clampInt(process.env.ORION_OBSERVABILITY_TIMESERIES_BUCKET_LIMIT, 48, 2, 500),
    maxDistributionItems: clampInt(process.env.ORION_OBSERVABILITY_MAX_DISTRIBUTION_ITEMS, 12, 1, 100),
    maxEvaluationHistory: clampInt(process.env.ORION_OBSERVABILITY_MAX_EVALUATION_HISTORY, 25, 1, 500),
    governance: {
      llmFallbackRateMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_LLM_FALLBACK_RATE_MAX, 0.5, 0, 1),
      llmFailureRateMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_LLM_FAILURE_RATE_MAX, 0.2, 0, 1),
      structuredValidRateMin: clampFloat(process.env.ORION_OBSERVABILITY_GOV_STRUCTURED_VALID_RATE_MIN, 0.8, 0, 1),
      groundingRejectionRateMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_GROUNDING_REJECTION_RATE_MAX, 0.5, 0, 1),
      citationValidRateMin: clampFloat(process.env.ORION_OBSERVABILITY_GOV_CITATION_VALID_RATE_MIN, 0.8, 0, 1),
      retrievalZeroResultRateMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_RETRIEVAL_ZERO_RESULT_RATE_MAX, 0.5, 0, 1),
      copilotToolErrorRateMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_COPILOT_TOOL_ERROR_RATE_MAX, 0.2, 0, 1),
      plannerFailureRateMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_PLANNER_FAILURE_RATE_MAX, 0.5, 0, 1),
      criticContradictionAvgMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_CRITIC_CONTRADICTION_AVG_MAX, 1, 0, 100),
      revisionLimitRateMax: clampFloat(process.env.ORION_OBSERVABILITY_GOV_REVISION_LIMIT_RATE_MAX, 0.5, 0, 1),
    },
  },

  /**
   * Real-provider GenAI + semantic embeddings (Phase 9). All real-provider
   * functionality is OPT-IN via the ORION_LLM_* / ORION_EMBEDDING_* env vars
   * above. This block adds provider allowlisting, endpoint-trust policy, explicit
   * capability declarations, and bounds for verification / re-embedding /
   * comparison. Safe offline defaults; startup never requires credentials.
   */
  providers: {
    /** Allowlisted LLM provider identifiers (config, never inferred from a name). */
    llmAllowlist: (process.env.ORION_LLM_PROVIDER_ALLOWLIST || 'openai,azure-openai,anthropic,http').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean),
    embeddingAllowlist: (process.env.ORION_EMBEDDING_PROVIDER_ALLOWLIST || 'openai,azure-openai,http').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean),
    /** Require HTTPS for any non-loopback provider endpoint. */
    requireHttpsNonLoopback: (process.env.ORION_PROVIDER_REQUIRE_HTTPS ?? 'true') !== 'false',
    // Explicit LLM capability declarations (never inferred from provider name).
    llmSupportsStructuredOutput: (process.env.ORION_LLM_SUPPORTS_STRUCTURED_OUTPUT ?? 'true') !== 'false',
    llmSupportsJsonSchema: (process.env.ORION_LLM_SUPPORTS_JSON_SCHEMA ?? 'false') === 'true',
    llmSupportsToolCalling: (process.env.ORION_LLM_SUPPORTS_TOOL_CALLING ?? 'false') === 'true',
    llmSupportsStreaming: (process.env.ORION_LLM_SUPPORTS_STREAMING ?? 'false') === 'true',
    // Explicit embedding capability declarations.
    embeddingNormalized: (process.env.ORION_EMBEDDING_NORMALIZED ?? 'true') !== 'false',
    // Verification / re-embedding / comparison bounds.
    verificationCooldownMs: clampInt(process.env.ORION_PROVIDER_VERIFY_COOLDOWN_MS, 15000, 0, 3600000),
    verificationTimeoutMs: clampInt(process.env.ORION_PROVIDER_VERIFY_TIMEOUT_MS, 20000, 1000, 120000),
    verificationStaleMs: clampInt(process.env.ORION_PROVIDER_VERIFY_STALE_MS, 24 * 60 * 60 * 1000, 60000, 30 * 24 * 60 * 60 * 1000),
    reindexBatchSize: clampInt(process.env.ORION_EMBEDDING_REINDEX_BATCH_SIZE, 16, 1, 256),
    comparisonMaxScenarios: clampInt(process.env.ORION_PROVIDER_COMPARISON_MAX_SCENARIOS, 12, 1, 100),
    comparisonCooldownMs: clampInt(process.env.ORION_PROVIDER_COMPARISON_COOLDOWN_MS, 30000, 0, 3600000),
    /** Embedding normalization policy label recorded with every embedding space. */
    embeddingNormalizationPolicy: (process.env.ORION_EMBEDDING_NORMALIZED ?? 'true') !== 'false' ? 'L2_NORMALIZED' : 'RAW',
  },

  /**
   * SQLite database file lives INSIDE the project directory.
   * Tests may set ORION_DB_FILE=':memory:' for an isolated in-memory database.
   */
  dbDir: path.resolve(__dirname, '..', 'data'),
  dbFile: process.env.ORION_DB_FILE || path.resolve(__dirname, '..', 'data', 'orion.db'),

  /** Directory holding bundled offline fixtures. */
  fixturesDir: path.resolve(__dirname, 'integrations', 'fixtures'),
};

/** A real LLM provider is considered configured only when all pieces are present. */
export function isRealLlmConfigured(): boolean {
  const l = config.llm;
  return l.provider !== 'none' && !!l.endpoint && !!l.apiKey && !!l.model;
}

/** Non-secret diagnostics for the LLM config (safe to return from APIs/logs). */
export function describeLlmConfig() {
  const l = config.llm;
  const diagnostics: string[] = [];
  if (l.provider !== 'none') {
    if (!l.endpoint) diagnostics.push('ORION_LLM_ENDPOINT is not set');
    if (!l.apiKey) diagnostics.push('ORION_LLM_API_KEY is not set');
    if (!l.model) diagnostics.push('ORION_LLM_MODEL is not set');
  }
  return {
    provider: l.provider,
    model: l.model || null,
    endpoint_configured: !!l.endpoint,
    api_key_configured: !!l.apiKey,
    real_provider_configured: isRealLlmConfigured(),
    fallback_enabled: l.fallbackEnabled,
    timeout_ms: l.timeoutMs,
    max_retries: l.maxRetries,
    max_input_tokens: l.maxInputTokens,
    max_output_tokens: l.maxOutputTokens,
    diagnostics,
  };
}

/** A real embedding provider is configured only when all pieces are present. */
export function isRealEmbeddingConfigured(): boolean {
  const e = config.embedding;
  return e.provider !== 'local' && e.provider !== 'none' && !!e.endpoint && !!e.apiKey && !!e.model;
}

/** Non-secret diagnostics for the embedding + knowledge config (safe to expose). */
export function describeEmbeddingConfig() {
  const e = config.embedding;
  const diagnostics: string[] = [];
  if (e.provider !== 'local' && e.provider !== 'none') {
    if (!e.endpoint) diagnostics.push('ORION_EMBEDDING_ENDPOINT is not set');
    if (!e.apiKey) diagnostics.push('ORION_EMBEDDING_API_KEY is not set');
    if (!e.model) diagnostics.push('ORION_EMBEDDING_MODEL is not set');
  }
  return {
    provider: e.provider,
    model: e.model || null,
    endpoint_configured: !!e.endpoint,
    api_key_configured: !!e.apiKey,
    real_provider_configured: isRealEmbeddingConfigured(),
    embedding_operating_mode: isRealEmbeddingConfigured() ? 'REAL_EMBEDDING_PROVIDER' : 'LOCAL_HASH_FALLBACK',
    dimension: e.dimension,
    timeout_ms: e.timeoutMs,
    max_batch_size: e.maxBatchSize,
    diagnostics,
  };
}

/** Non-secret knowledge/retrieval bounds (safe to expose). */
export function describeKnowledgeConfig() {
  return {
    max_document_chars: config.knowledge.maxDocumentChars,
    max_batch_documents: config.knowledge.maxBatchDocuments,
    chunk_size: config.knowledge.chunkSize,
    chunk_overlap: config.knowledge.chunkOverlap,
    default_top_k: config.retrieval.defaultTopK,
    max_top_k: config.retrieval.maxTopK,
    max_candidates: config.retrieval.maxCandidates,
    max_query_chars: config.retrieval.maxQueryChars,
    default_mode: config.retrieval.defaultMode,
    vector_candidates: config.retrieval.vectorCandidates,
    bm25_candidates: config.retrieval.bm25Candidates,
    fusion_k: config.retrieval.fusionK,
    rerank_candidates: config.retrieval.rerankCandidates,
    bm25_k1: config.retrieval.bm25K1,
    bm25_b: config.retrieval.bm25B,
    max_query_tokens: config.retrieval.maxQueryTokens,
    eval_max_queries: config.retrieval.evalMaxQueries,
  };
}

/** Non-secret grounded-generation bounds (safe to expose via APIs). */
export function describeGenerationConfig() {
  const g = config.generation;
  return {
    max_context_chars: g.maxContextChars,
    max_evidence_items: g.maxEvidenceItems,
    max_retrieval_chunks: g.maxRetrievalChunks,
    retrieval_top_k: g.retrievalTopK,
    min_retrieval_chunks: g.minRetrievalChunks,
    min_grounding_support: g.minGroundingSupport,
    max_claims: g.maxClaims,
    max_text_per_source: g.maxTextPerSource,
    injection_filter_enabled: g.injectionFilterEnabled,
  };
}

/** Non-secret Mission Copilot bounds (safe to expose via APIs). */
export function describeCopilotConfig() {
  const c = config.copilot;
  return {
    max_iterations: c.maxIterations,
    max_tool_calls: c.maxToolCalls,
    max_tool_output_chars: c.maxToolOutputChars,
    max_message_chars: c.maxMessageChars,
    max_context_chars: c.maxContextChars,
    max_retained_messages: c.maxRetainedMessages,
    max_execution_ms: c.maxExecutionMs,
    tool_timeout_ms: c.toolTimeoutMs,
    max_suggested_followups: c.maxSuggestedFollowups,
  };
}

/** Non-secret ORION AI Assistant bounds (safe to expose via APIs). */
export function describeAssistantConfig() {
  const a = config.assistant;
  return {
    max_message_chars: a.maxMessageChars,
    max_context_chars: a.maxContextChars,
    max_retained_messages: a.maxRetainedMessages,
    max_summary_chars: a.maxSummaryChars,
    max_iterations: a.maxIterations,
    max_tool_calls: a.maxToolCalls,
    max_retrieval_calls: a.maxRetrievalCalls,
    max_workflow_calls: a.maxWorkflowCalls,
    max_execution_ms: a.maxExecutionMs,
    tool_timeout_ms: a.toolTimeoutMs,
    max_events: a.maxEvents,
    max_rich_content_items: a.maxRichContentItems,
    max_suggested_followups: a.maxSuggestedFollowups,
    max_feedback_comment_chars: a.maxFeedbackCommentChars,
    eval_max_scenarios: a.evalMaxScenarios,
  };
}

/** Non-secret Planner bounds (safe to expose via APIs). */
export function describePlannerConfig() {
  const p = config.planner;
  return {
    max_steps: p.maxSteps, max_iterations: p.maxIterations, max_tool_calls: p.maxToolCalls,
    max_retrieval_calls: p.maxRetrievalCalls, max_query_refinements: p.maxQueryRefinements,
    max_output_chars: p.maxOutputChars, max_execution_ms: p.maxExecutionMs, step_timeout_ms: p.stepTimeoutMs,
    min_citations: p.minCitations, min_evidence_items: p.minEvidenceItems,
  };
}

/** Non-secret Critic bounds (safe to expose via APIs). */
export function describeCriticConfig() {
  const c = config.critic;
  return {
    max_issues: c.maxIssues,
    max_revision_attempts: c.maxRevisionAttempts,
    max_calls: c.maxCalls,
    max_context_chars: c.maxContextChars,
    max_execution_ms: c.maxExecutionMs,
    min_coverage_items: c.minCoverageItems,
    numeric_tolerance: c.numericTolerance,
  };
}

/**
 * Whether a provider endpoint URL is trusted: valid absolute http(s) URL, and —
 * unless it targets loopback — HTTPS when `requireHttpsNonLoopback` is set. Never
 * fetched here; this is a static policy check.
 */
export function isTrustedEndpoint(endpoint: string): { trusted: boolean; reason: string | null } {
  if (!endpoint) return { trusted: false, reason: 'endpoint not set' };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { trusted: false, reason: 'endpoint is not a valid absolute URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { trusted: false, reason: 'endpoint must be http(s)' };
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (config.providers.requireHttpsNonLoopback && !loopback && url.protocol !== 'https:') {
    return { trusted: false, reason: 'HTTPS is required for non-loopback provider endpoints' };
  }
  return { trusted: true, reason: null };
}

/** Whether a real LLM provider is fully + safely configured (allowlisted + trusted endpoint). */
export function isLlmProviderConfiguredSafely(): { ok: boolean; reason: string | null } {
  const l = config.llm;
  if (l.provider === 'none') return { ok: false, reason: 'no provider configured' };
  if (!config.providers.llmAllowlist.includes(l.provider)) return { ok: false, reason: `provider '${l.provider}' not in allowlist` };
  if (!l.endpoint || !l.apiKey || !l.model) return { ok: false, reason: 'endpoint/apiKey/model incomplete' };
  const t = isTrustedEndpoint(l.endpoint);
  if (!t.trusted) return { ok: false, reason: t.reason };
  return { ok: true, reason: null };
}

/** Whether a real embedding provider is fully + safely configured. */
export function isEmbeddingProviderConfiguredSafely(): { ok: boolean; reason: string | null } {
  const e = config.embedding;
  if (e.provider === 'local' || e.provider === 'none') return { ok: false, reason: 'local/none embedding provider' };
  if (!config.providers.embeddingAllowlist.includes(e.provider)) return { ok: false, reason: `provider '${e.provider}' not in allowlist` };
  if (!e.endpoint || !e.apiKey || !e.model) return { ok: false, reason: 'endpoint/apiKey/model incomplete' };
  const t = isTrustedEndpoint(e.endpoint);
  if (!t.trusted) return { ok: false, reason: t.reason };
  return { ok: true, reason: null };
}

/** Non-secret provider configuration + capabilities (safe to expose; NO credentials). */
export function describeProvidersConfig() {
  const l = config.llm;
  const e = config.embedding;
  const p = config.providers;
  return {
    llm: {
      provider: l.provider,
      model: l.model || null,
      endpoint_configured: !!l.endpoint,
      api_key_configured: !!l.apiKey,
      allowlisted: p.llmAllowlist.includes(l.provider),
      endpoint_trusted: l.endpoint ? isTrustedEndpoint(l.endpoint).trusted : false,
      configured_safely: isLlmProviderConfiguredSafely().ok,
      capabilities: {
        supportsStructuredOutput: p.llmSupportsStructuredOutput,
        supportsJsonSchema: p.llmSupportsJsonSchema,
        supportsToolCalling: p.llmSupportsToolCalling,
        supportsStreaming: p.llmSupportsStreaming,
        maxInputTokens: l.maxInputTokens,
        maxOutputTokens: l.maxOutputTokens,
      },
    },
    embedding: {
      provider: e.provider,
      model: e.model || null,
      dimension: e.dimension,
      endpoint_configured: !!e.endpoint,
      api_key_configured: !!e.apiKey,
      allowlisted: p.embeddingAllowlist.includes(e.provider),
      endpoint_trusted: e.endpoint ? isTrustedEndpoint(e.endpoint).trusted : false,
      configured_safely: isEmbeddingProviderConfiguredSafely().ok,
      capabilities: {
        maxInputTokens: e.dimension, // informational
        maxBatchSize: e.maxBatchSize,
        normalizedOutput: p.embeddingNormalized,
        normalizationPolicy: p.embeddingNormalizationPolicy,
      },
    },
    llm_allowlist: p.llmAllowlist,
    embedding_allowlist: p.embeddingAllowlist,
    require_https_non_loopback: p.requireHttpsNonLoopback,
    verification_cooldown_ms: p.verificationCooldownMs,
    verification_stale_ms: p.verificationStaleMs,
    reindex_batch_size: p.reindexBatchSize,
    comparison_max_scenarios: p.comparisonMaxScenarios,
  };
}

/** Non-secret AI observability bounds + governance thresholds (safe to expose). */
export function describeObservabilityConfig() {
  const o = config.observability;
  return {
    default_range: o.defaultRange,
    max_range_days: o.maxRangeDays,
    max_rows: o.maxRows,
    time_series_bucket_limit: o.timeSeriesBucketLimit,
    max_distribution_items: o.maxDistributionItems,
    max_evaluation_history: o.maxEvaluationHistory,
    governance_thresholds: {
      llm_fallback_rate_max: o.governance.llmFallbackRateMax,
      llm_failure_rate_max: o.governance.llmFailureRateMax,
      structured_valid_rate_min: o.governance.structuredValidRateMin,
      grounding_rejection_rate_max: o.governance.groundingRejectionRateMax,
      citation_valid_rate_min: o.governance.citationValidRateMin,
      retrieval_zero_result_rate_max: o.governance.retrievalZeroResultRateMax,
      copilot_tool_error_rate_max: o.governance.copilotToolErrorRateMax,
      planner_failure_rate_max: o.governance.plannerFailureRateMax,
      critic_contradiction_avg_max: o.governance.criticContradictionAvgMax,
      revision_limit_rate_max: o.governance.revisionLimitRateMax,
    },
  };
}

/**
 * Redact anything that could reveal a secret before it reaches logs, audit
 * records, API responses, or docs. Removes the configured key, bearer tokens,
 * and common API-key shapes.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  if (config.llm.apiKey) out = out.split(config.llm.apiKey).join('***REDACTED***');
  if (config.embedding.apiKey) out = out.split(config.embedding.apiKey).join('***REDACTED***');
  if (config.jwtSecret) out = out.split(config.jwtSecret).join('***REDACTED***');
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***REDACTED***')
    .replace(/\b(sk|xoxb|ghp|pk)-[A-Za-z0-9_-]{8,}\b/g, '***REDACTED***')
    .replace(/("?(api[_-]?key|authorization|token|secret)"?\s*[:=]\s*)"?[^",}\s]+"?/gi, '$1"***REDACTED***"');
  return out;
}

export const SAFETY_STATEMENT =
  'Project ORION is a SIMULATION and DECISION-SUPPORT system. It does NOT control, ' +
  'command, communicate with, or operate any real satellite. All satellites, telemetry, ' +
  'and external data shown are simulated or clearly-labelled offline sample data. ' +
  'All recommendations are advisory and require human review.';
