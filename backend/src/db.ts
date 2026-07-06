/**
 * Database layer using Node's built-in `node:sqlite` (no native compilation).
 * The SQLite file lives inside the project directory (backend/data/orion.db).
 * Schema is created on first run; seed data is inserted when empty.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { config } from './config.js';

// Load node:sqlite via a runtime require so bundlers (Vite/Vitest) don't try to
// statically resolve the newer `node:sqlite` builtin at transform time.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

// Ensure the data directory exists (inside the project) for file-backed DBs.
if (config.dbFile !== ':memory:') {
  fs.mkdirSync(config.dbDir, { recursive: true });
}

/**
 * Minimal typed facade over node:sqlite. node:sqlite statements return
 * `Record<string, SQLOutputValue>`, which TypeScript refuses to directly cast
 * to our row interfaces. Exposing `.all()/.get()` as returning `any` lets each
 * call site apply its own row type (`... as Alert[]`) cleanly and in one place.
 */
interface Stmt {
  all(...params: unknown[]): any[];
  get(...params: unknown[]): any;
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
}
interface DbFacade {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
}

const rawDb = new DatabaseSync(config.dbFile);
export const db: DbFacade = rawDb as unknown as DbFacade;

// Pragmas for reliability + performance on a single-process app.
// (WAL requires a file-backed DB; skip for in-memory test databases.)
if (config.dbFile !== ':memory:') {
  db.exec('PRAGMA journal_mode = WAL;');
}
db.exec('PRAGMA foreign_keys = ON;');

/** ISO-8601 UTC timestamp helper used everywhere for consistency. */
export function now(): string {
  return new Date().toISOString();
}

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS satellites (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      norad_id      TEXT NOT NULL,
      mission       TEXT NOT NULL,
      orbit_type    TEXT NOT NULL,
      altitude      REAL NOT NULL,
      velocity      REAL NOT NULL,
      latitude      REAL NOT NULL,
      longitude     REAL NOT NULL,
      health_score  REAL NOT NULL,
      status        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      satellite_id        TEXT NOT NULL,
      timestamp           TEXT NOT NULL,
      temperature_c       REAL NOT NULL,
      battery_percent     REAL NOT NULL,
      signal_strength_dbm REAL NOT NULL,
      power_consumption_w REAL NOT NULL,
      altitude_km         REAL NOT NULL,
      velocity_kms        REAL NOT NULL,
      latitude            REAL NOT NULL,
      longitude           REAL NOT NULL,
      FOREIGN KEY (satellite_id) REFERENCES satellites(id)
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_sat_time
      ON telemetry (satellite_id, timestamp);

    CREATE TABLE IF NOT EXISTS alerts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      satellite_id     TEXT NOT NULL,
      anomaly_type     TEXT NOT NULL,
      severity         TEXT NOT NULL,
      message          TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'ACTIVE',
      investigation_id INTEGER,
      created_at       TEXT NOT NULL,
      FOREIGN KEY (satellite_id) REFERENCES satellites(id)
    );

    CREATE TABLE IF NOT EXISTS investigations (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      title              TEXT NOT NULL,
      satellite_id       TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'DETECTED',
      priority           TEXT NOT NULL DEFAULT 'MEDIUM',
      detected_anomalies TEXT NOT NULL DEFAULT '[]',
      root_cause         TEXT,
      confidence         REAL,
      severity           TEXT,
      explanation        TEXT,
      scoring_breakdown  TEXT,
      review_decision    TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      reviewed_at        TEXT,
      resolved_at        TEXT,
      FOREIGN KEY (satellite_id) REFERENCES satellites(id)
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_id    INTEGER NOT NULL,
      source_type         TEXT NOT NULL,
      source_name         TEXT NOT NULL,
      summary             TEXT NOT NULL,
      details             TEXT NOT NULL DEFAULT '{}',
      reliability_score   REAL NOT NULL DEFAULT 0.5,
      supports_root_cause INTEGER NOT NULL DEFAULT 0,
      timestamp           TEXT NOT NULL,
      source_url          TEXT,
      mode                TEXT,
      cached              INTEGER NOT NULL DEFAULT 0,
      fallback_used       INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id)
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_id INTEGER NOT NULL,
      action           TEXT NOT NULL,
      rationale        TEXT NOT NULL,
      priority         TEXT NOT NULL DEFAULT 'MEDIUM',
      FOREIGN KEY (investigation_id) REFERENCES investigations(id)
    );

    CREATE TABLE IF NOT EXISTS agent_executions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_id INTEGER NOT NULL,
      agent_id         TEXT NOT NULL,
      agent_name       TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'PENDING',
      started_at       TEXT NOT NULL,
      completed_at     TEXT,
      duration_ms      INTEGER,
      input_summary    TEXT NOT NULL DEFAULT '',
      output_summary   TEXT NOT NULL DEFAULT '',
      error_message    TEXT,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_id INTEGER NOT NULL,
      title            TEXT NOT NULL,
      content          TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    -- LLM execution audit trail (Phase 1). Stores NO secrets, and by default no
    -- raw prompts/responses (only opt-in, sanitized, truncated summaries).
    CREATE TABLE IF NOT EXISTS llm_executions (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id              TEXT NOT NULL,
      investigation_id            INTEGER,
      agent_execution_id          INTEGER,
      provider                    TEXT NOT NULL,
      model                       TEXT NOT NULL,
      execution_mode              TEXT NOT NULL,
      execution_status            TEXT NOT NULL,
      prompt_version              TEXT NOT NULL,
      request_type                TEXT NOT NULL,
      input_token_count           INTEGER,
      output_token_count          INTEGER,
      total_token_count           INTEGER,
      latency_ms                  INTEGER NOT NULL,
      retry_count                 INTEGER NOT NULL DEFAULT 0,
      structured_output_requested INTEGER NOT NULL DEFAULT 0,
      structured_output_valid     INTEGER,
      validation_errors           TEXT,
      fallback_reason             TEXT,
      error_code                  TEXT,
      sanitized_error_message     TEXT,
      request_summary             TEXT,
      response_summary            TEXT,
      created_at                  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_corr    ON llm_executions (correlation_id);
    CREATE INDEX IF NOT EXISTS idx_llm_inv     ON llm_executions (investigation_id);
    CREATE INDEX IF NOT EXISTS idx_llm_mode    ON llm_executions (execution_mode);
    CREATE INDEX IF NOT EXISTS idx_llm_status  ON llm_executions (execution_status);
    CREATE INDEX IF NOT EXISTS idx_llm_created ON llm_executions (created_at);

    -- ==========================================================================
    -- Mission Knowledge Base (Phase 2). Offline-first ingestion + vector store.
    -- Stores NO secrets and NO Authorization headers. Content is synthetic /
    -- caller-supplied plain text only; source_uri is an opaque provenance label
    -- that is NEVER fetched or dereferenced.
    -- ==========================================================================
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      stable_document_id TEXT NOT NULL UNIQUE,
      title              TEXT NOT NULL,
      source_type        TEXT NOT NULL,
      classification     TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
      subsystem          TEXT,
      satellite_id       TEXT,
      anomaly_type       TEXT,
      document_version   TEXT NOT NULL DEFAULT 'v1',
      source_uri         TEXT,
      provenance_origin  TEXT NOT NULL DEFAULT 'API_INGESTION',
      content_hash       TEXT NOT NULL,
      normalized_content TEXT NOT NULL,
      char_count         INTEGER NOT NULL DEFAULT 0,
      chunk_count        INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'PENDING',
      failure_reason     TEXT,
      created_by         TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      archived_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_kdoc_status  ON knowledge_documents (status);
    CREATE INDEX IF NOT EXISTS idx_kdoc_source  ON knowledge_documents (source_type);
    CREATE INDEX IF NOT EXISTS idx_kdoc_sub     ON knowledge_documents (subsystem);
    CREATE INDEX IF NOT EXISTS idx_kdoc_sat     ON knowledge_documents (satellite_id);
    CREATE INDEX IF NOT EXISTS idx_kdoc_hash    ON knowledge_documents (content_hash);

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      stable_chunk_id       TEXT NOT NULL UNIQUE,
      document_id           INTEGER NOT NULL,
      chunk_index           INTEGER NOT NULL,
      citation_id           TEXT NOT NULL UNIQUE,
      content               TEXT NOT NULL,
      content_hash          TEXT NOT NULL,
      start_offset          INTEGER,
      end_offset            INTEGER,
      token_count_estimate  INTEGER,
      metadata_json         TEXT NOT NULL DEFAULT '{}',
      embedding_provider    TEXT NOT NULL,
      embedding_model       TEXT NOT NULL,
      embedding_mode        TEXT NOT NULL,
      embedding_version     TEXT NOT NULL,
      embedding_dimension   INTEGER NOT NULL,
      embedding_json        TEXT NOT NULL,
      created_at            TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES knowledge_documents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_kchunk_doc      ON knowledge_chunks (document_id);
    CREATE INDEX IF NOT EXISTS idx_kchunk_citation ON knowledge_chunks (citation_id);
    CREATE INDEX IF NOT EXISTS idx_kchunk_mode     ON knowledge_chunks (embedding_mode);

    CREATE TABLE IF NOT EXISTS retrieval_executions (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id           TEXT NOT NULL,
      query_hash               TEXT NOT NULL,
      sanitized_query_summary  TEXT,
      retrieval_mode           TEXT NOT NULL,
      embedding_provider       TEXT NOT NULL,
      embedding_model          TEXT NOT NULL,
      embedding_mode           TEXT NOT NULL,
      requested_top_k          INTEGER NOT NULL,
      effective_top_k          INTEGER NOT NULL,
      filters_json             TEXT,
      candidate_count          INTEGER NOT NULL DEFAULT 0,
      returned_count           INTEGER NOT NULL DEFAULT 0,
      latency_ms               INTEGER NOT NULL,
      status                   TEXT NOT NULL,
      error_code               TEXT,
      sanitized_error_message  TEXT,
      created_by               TEXT,
      created_at               TEXT NOT NULL,
      -- Phase 3 hybrid-retrieval diagnostics (nullable; older rows read as NULL):
      vector_candidate_count   INTEGER,
      bm25_candidate_count     INTEGER,
      fused_candidate_count    INTEGER,
      reranked_candidate_count INTEGER,
      fusion_k                 INTEGER,
      reranker_version         TEXT,
      evaluation_run_id        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_rexec_corr    ON retrieval_executions (correlation_id);
    CREATE INDEX IF NOT EXISTS idx_rexec_mode    ON retrieval_executions (retrieval_mode);
    CREATE INDEX IF NOT EXISTS idx_rexec_status  ON retrieval_executions (status);
    CREATE INDEX IF NOT EXISTS idx_rexec_created ON retrieval_executions (created_at);

    -- Retrieval quality evaluation runs (Phase 3). Measured metrics over the
    -- synthetic benchmark. No secrets, no embeddings.
    CREATE TABLE IF NOT EXISTS retrieval_evaluation_runs (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id           TEXT NOT NULL,
      dataset_version          TEXT NOT NULL,
      retrieval_mode           TEXT NOT NULL,
      configuration_json       TEXT NOT NULL DEFAULT '{}',
      query_count              INTEGER NOT NULL DEFAULT 0,
      k_value                  INTEGER NOT NULL,
      precision_at_k           REAL NOT NULL DEFAULT 0,
      recall_at_k              REAL NOT NULL DEFAULT 0,
      mrr                      REAL NOT NULL DEFAULT 0,
      hit_rate_at_k            REAL NOT NULL DEFAULT 0,
      ndcg_at_k                REAL,
      average_latency_ms       REAL NOT NULL DEFAULT 0,
      status                   TEXT NOT NULL,
      error_code               TEXT,
      sanitized_error_message  TEXT,
      created_by               TEXT,
      created_at               TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reval_mode    ON retrieval_evaluation_runs (retrieval_mode);
    CREATE INDEX IF NOT EXISTS idx_reval_created ON retrieval_evaluation_runs (created_at);

    -- Grounded generation executions (Phase 4). One row per generation attempt.
    -- Stores NO prompts, NO raw retrieved chunks, NO raw model responses, NO
    -- secrets, NO embeddings — only bounded outcome + diagnostics.
    CREATE TABLE IF NOT EXISTS grounded_generation_executions (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id           TEXT NOT NULL,
      investigation_id         INTEGER NOT NULL,
      use_case                 TEXT NOT NULL,
      generation_status        TEXT NOT NULL,
      llm_execution_id         INTEGER,
      provider_execution_mode  TEXT,
      provider                 TEXT,
      model                    TEXT,
      prompt_version           TEXT NOT NULL,
      retrieval_execution_id   INTEGER,
      retrieval_mode           TEXT,
      context_source_count     INTEGER NOT NULL DEFAULT 0,
      included_evidence_count  INTEGER NOT NULL DEFAULT 0,
      included_citation_count  INTEGER NOT NULL DEFAULT 0,
      excluded_source_count    INTEGER NOT NULL DEFAULT 0,
      injection_flag_count     INTEGER NOT NULL DEFAULT 0,
      schema_valid             INTEGER,
      citation_valid           INTEGER,
      evidence_valid           INTEGER,
      grounding_valid          INTEGER,
      policy_valid             INTEGER,
      context_sufficient       INTEGER,
      claim_count              INTEGER NOT NULL DEFAULT 0,
      supported_claim_count    INTEGER NOT NULL DEFAULT 0,
      unsupported_claim_count  INTEGER NOT NULL DEFAULT 0,
      average_grounding_support REAL,
      latency_ms               INTEGER NOT NULL DEFAULT 0,
      fallback_reason          TEXT,
      rejection_reason         TEXT,
      sanitized_error_message  TEXT,
      created_by               TEXT,
      created_at               TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ggen_corr    ON grounded_generation_executions (correlation_id);
    CREATE INDEX IF NOT EXISTS idx_ggen_inv     ON grounded_generation_executions (investigation_id);
    CREATE INDEX IF NOT EXISTS idx_ggen_status  ON grounded_generation_executions (generation_status);
    CREATE INDEX IF NOT EXISTS idx_ggen_created ON grounded_generation_executions (created_at);

    -- ==========================================================================
    -- Mission Copilot (Phase 5). READ-ONLY conversational RAG + tool calling.
    -- Short-term conversation memory only. Stores NO secrets, NO raw prompts, NO
    -- hidden chain-of-thought, NO raw vectors, NO unrestricted tool payloads.
    -- ==========================================================================
    CREATE TABLE IF NOT EXISTS copilot_conversations (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      role         TEXT NOT NULL,
      title        TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      archived_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conv_user ON copilot_conversations (user_id, status);

    CREATE TABLE IF NOT EXISTS copilot_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role            TEXT NOT NULL,           -- 'user' | 'assistant'
      content         TEXT NOT NULL,           -- sanitized text only
      execution_mode  TEXT,                    -- assistant only
      correlation_id  TEXT,
      created_at      TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES copilot_conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON copilot_messages (conversation_id, id);

    CREATE TABLE IF NOT EXISTS copilot_executions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id        TEXT NOT NULL,
      conversation_id       TEXT NOT NULL,
      message_id            INTEGER,
      user_id               TEXT NOT NULL,
      execution_mode        TEXT NOT NULL,
      provider              TEXT,
      model                 TEXT,
      iteration_count       INTEGER NOT NULL DEFAULT 0,
      tool_call_count       INTEGER NOT NULL DEFAULT 0,
      retrieval_execution_ids TEXT,            -- JSON array
      llm_execution_ids       TEXT,            -- JSON array
      generation_status     TEXT,
      grounding_status      TEXT,
      citation_count        INTEGER NOT NULL DEFAULT 0,
      evidence_count        INTEGER NOT NULL DEFAULT 0,
      latency_ms            INTEGER NOT NULL DEFAULT 0,
      fallback_reason       TEXT,
      failure_reason        TEXT,
      created_at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cexec_conv    ON copilot_executions (conversation_id);
    CREATE INDEX IF NOT EXISTS idx_cexec_created ON copilot_executions (created_at);

    CREATE TABLE IF NOT EXISTS copilot_tool_executions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id    TEXT NOT NULL,
      conversation_id   TEXT NOT NULL,
      message_id        INTEGER,
      tool_call_id      TEXT NOT NULL,
      tool_name         TEXT NOT NULL,
      tool_version      TEXT NOT NULL,
      execution_mode    TEXT NOT NULL,
      input_summary     TEXT,
      output_summary    TEXT,
      status            TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      latency_ms        INTEGER NOT NULL DEFAULT 0,
      error_code        TEXT,
      sanitized_error   TEXT,
      created_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ctool_corr ON copilot_tool_executions (correlation_id);
    CREATE INDEX IF NOT EXISTS idx_ctool_conv ON copilot_tool_executions (conversation_id);

    -- ==========================================================================
    -- Bounded Planner Agent + Agentic RAG (Phase 6). READ-ONLY analysis audit.
    -- No raw prompts, no hidden reasoning, no raw embeddings, no secrets, no
    -- unrestricted tool payloads — bounded summaries only.
    -- ==========================================================================
    CREATE TABLE IF NOT EXISTS planner_executions (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id           TEXT NOT NULL,
      investigation_id         INTEGER NOT NULL,
      user_id                  TEXT NOT NULL,
      execution_mode           TEXT NOT NULL,
      plan_version             TEXT NOT NULL,
      plan_status              TEXT NOT NULL,
      objective_summary        TEXT,
      step_count               INTEGER NOT NULL DEFAULT 0,
      completed_step_count     INTEGER NOT NULL DEFAULT 0,
      failed_step_count        INTEGER NOT NULL DEFAULT 0,
      iteration_count          INTEGER NOT NULL DEFAULT 0,
      tool_call_count          INTEGER NOT NULL DEFAULT 0,
      retrieval_call_count     INTEGER NOT NULL DEFAULT 0,
      knowledge_gap_count      INTEGER NOT NULL DEFAULT 0,
      llm_execution_ids_json   TEXT,
      retrieval_execution_ids_json TEXT,
      citation_count           INTEGER NOT NULL DEFAULT 0,
      evidence_count           INTEGER NOT NULL DEFAULT 0,
      grounding_status         TEXT,
      latency_ms               INTEGER NOT NULL DEFAULT 0,
      fallback_reason          TEXT,
      failure_reason           TEXT,
      created_at               TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pexec_inv     ON planner_executions (investigation_id);
    CREATE INDEX IF NOT EXISTS idx_pexec_created ON planner_executions (created_at);

    CREATE TABLE IF NOT EXISTS planner_step_executions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      planner_execution_id   INTEGER NOT NULL,
      step_id                TEXT NOT NULL,
      step_type              TEXT NOT NULL,
      step_order             INTEGER NOT NULL,
      status                 TEXT NOT NULL,
      dependency_ids_json    TEXT,
      tool_name              TEXT,
      tool_execution_id      INTEGER,
      retrieval_execution_id INTEGER,
      input_summary          TEXT,
      output_summary         TEXT,
      latency_ms             INTEGER NOT NULL DEFAULT 0,
      error_code             TEXT,
      sanitized_error        TEXT,
      created_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pstep_exec ON planner_step_executions (planner_execution_id);

    CREATE TABLE IF NOT EXISTS planner_retrieval_refinements (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      planner_execution_id    INTEGER NOT NULL,
      iteration               INTEGER NOT NULL,
      gap_type                TEXT,
      query_hash              TEXT NOT NULL,
      sanitized_query_summary TEXT,
      retrieval_execution_id  INTEGER,
      result_count            INTEGER NOT NULL DEFAULT 0,
      new_citation_count      INTEGER NOT NULL DEFAULT 0,
      sufficiency_after       TEXT,
      created_at              TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pref_exec ON planner_retrieval_refinements (planner_execution_id);

    -- ==========================================================================
    -- Bounded Critic Agent + Reflection/Revision loop (Phase 7). READ-ONLY
    -- analysis-quality review audit. No raw prompts, no hidden reasoning, no raw
    -- model responses, no raw vectors, no unrestricted tool payloads, no secrets
    -- — bounded summaries only.
    -- ==========================================================================
    CREATE TABLE IF NOT EXISTS critic_executions (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id           TEXT NOT NULL,
      investigation_id         INTEGER NOT NULL,
      planner_execution_id     INTEGER,
      user_id                  TEXT NOT NULL,
      execution_mode           TEXT NOT NULL,
      review_version           TEXT NOT NULL,
      critic_status            TEXT NOT NULL,
      initial_decision         TEXT NOT NULL,
      final_decision           TEXT NOT NULL,
      issue_count              INTEGER NOT NULL DEFAULT 0,
      warning_count            INTEGER NOT NULL DEFAULT 0,
      error_count              INTEGER NOT NULL DEFAULT 0,
      critical_count           INTEGER NOT NULL DEFAULT 0,
      coverage_pass_count      INTEGER NOT NULL DEFAULT 0,
      coverage_fail_count      INTEGER NOT NULL DEFAULT 0,
      contradiction_count      INTEGER NOT NULL DEFAULT 0,
      revision_attempt_count   INTEGER NOT NULL DEFAULT 0,
      llm_execution_ids_json   TEXT,
      latency_ms               INTEGER NOT NULL DEFAULT 0,
      fallback_reason          TEXT,
      failure_reason           TEXT,
      human_review_required    INTEGER NOT NULL DEFAULT 1,
      created_at               TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cexec_inv     ON critic_executions (investigation_id);
    CREATE INDEX IF NOT EXISTS idx_cexec_planner ON critic_executions (planner_execution_id);
    CREATE INDEX IF NOT EXISTS idx_cexec_created2 ON critic_executions (created_at);

    CREATE TABLE IF NOT EXISTS critic_issues (
      id                            INTEGER PRIMARY KEY AUTOINCREMENT,
      critic_execution_id           INTEGER NOT NULL,
      issue_id                      TEXT NOT NULL,
      revision_attempt              INTEGER NOT NULL DEFAULT 0,
      severity                      TEXT NOT NULL,
      category                      TEXT NOT NULL,
      description_summary           TEXT,
      claim_index                   INTEGER,
      citation_ids_json             TEXT,
      evidence_ids_json             TEXT,
      recommended_correction_summary TEXT,
      resolved                      INTEGER NOT NULL DEFAULT 0,
      created_at                    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cissue_exec ON critic_issues (critic_execution_id);

    CREATE TABLE IF NOT EXISTS critic_revision_attempts (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      critic_execution_id    INTEGER NOT NULL,
      attempt_number         INTEGER NOT NULL,
      input_analysis_hash    TEXT NOT NULL,
      critique_hash          TEXT NOT NULL,
      output_analysis_hash   TEXT NOT NULL,
      validation_status      TEXT NOT NULL,
      critic_decision_after  TEXT NOT NULL,
      issue_count_after      INTEGER NOT NULL DEFAULT 0,
      latency_ms             INTEGER NOT NULL DEFAULT 0,
      failure_reason         TEXT,
      created_at             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crev_exec ON critic_revision_attempts (critic_execution_id);

    -- ==========================================================================
    -- Real-provider GenAI + embeddings (Phase 9). Append-only provider
    -- verification, embedding-space registry + re-index, and real-vs-fallback
    -- comparison audits. Stores NO API keys, Authorization headers, raw prompts,
    -- raw responses, raw embeddings, or hidden reasoning — bounded metadata only.
    -- ==========================================================================
    CREATE TABLE IF NOT EXISTS provider_verification_executions (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id            TEXT NOT NULL,
      provider_kind             TEXT NOT NULL,
      provider_name             TEXT NOT NULL,
      model                     TEXT,
      verification_type         TEXT NOT NULL,
      status                    TEXT NOT NULL,
      live_provider_reached     INTEGER NOT NULL DEFAULT 0,
      latency_ms                INTEGER NOT NULL DEFAULT 0,
      structured_output_valid   INTEGER,
      embedding_dimension_valid INTEGER,
      usage_metadata_available  INTEGER,
      normalized_error_code     TEXT,
      sanitized_error_message   TEXT,
      created_by                TEXT,
      created_at                TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pver_created ON provider_verification_executions (created_at);
    CREATE INDEX IF NOT EXISTS idx_pver_kind    ON provider_verification_executions (provider_kind);
    CREATE INDEX IF NOT EXISTS idx_pver_name    ON provider_verification_executions (provider_name);
    CREATE INDEX IF NOT EXISTS idx_pver_status  ON provider_verification_executions (status);

    CREATE TABLE IF NOT EXISTS embedding_spaces (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      space_key             TEXT NOT NULL UNIQUE,
      provider              TEXT NOT NULL,
      model                 TEXT NOT NULL,
      version               TEXT NOT NULL,
      dimension             INTEGER NOT NULL,
      normalization_policy  TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'PENDING',
      document_count        INTEGER NOT NULL DEFAULT 0,
      chunk_count           INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL,
      activated_at          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_espace_status ON embedding_spaces (status);

    CREATE TABLE IF NOT EXISTS embedding_reindex_executions (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id           TEXT NOT NULL,
      source_space_key         TEXT,
      target_space_key         TEXT NOT NULL,
      status                   TEXT NOT NULL,
      total_documents          INTEGER NOT NULL DEFAULT 0,
      processed_documents      INTEGER NOT NULL DEFAULT 0,
      total_chunks             INTEGER NOT NULL DEFAULT 0,
      processed_chunks         INTEGER NOT NULL DEFAULT 0,
      failed_documents         INTEGER NOT NULL DEFAULT 0,
      created_by               TEXT,
      started_at               TEXT NOT NULL,
      completed_at             TEXT,
      sanitized_error_message  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reindex_status ON embedding_reindex_executions (status);
    CREATE INDEX IF NOT EXISTS idx_reindex_created ON embedding_reindex_executions (started_at);

    CREATE TABLE IF NOT EXISTS provider_comparison_runs (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id           TEXT NOT NULL,
      dataset_version          TEXT NOT NULL,
      scenario_count           INTEGER NOT NULL DEFAULT 0,
      real_available           INTEGER NOT NULL DEFAULT 0,
      real_accepted_count      INTEGER NOT NULL DEFAULT 0,
      real_failed_count        INTEGER NOT NULL DEFAULT 0,
      fallback_count           INTEGER NOT NULL DEFAULT 0,
      real_grounding_valid_rate REAL,
      fallback_grounding_valid_rate REAL,
      real_avg_latency_ms      REAL,
      fallback_avg_latency_ms  REAL,
      status                   TEXT NOT NULL,
      created_by               TEXT,
      created_at               TEXT NOT NULL,
      sanitized_error_message  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pcmp_created ON provider_comparison_runs (created_at);

    CREATE TABLE IF NOT EXISTS provider_comparison_results (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      comparison_run_id        INTEGER NOT NULL,
      scenario_key             TEXT NOT NULL,
      arm                      TEXT NOT NULL,             -- REAL_PROVIDER | DETERMINISTIC_FALLBACK
      use_case                 TEXT NOT NULL,
      execution_mode           TEXT NOT NULL,
      structured_output_valid  INTEGER,
      grounding_valid          INTEGER,
      citation_valid           INTEGER,
      evidence_valid           INTEGER,
      policy_valid             INTEGER,
      fallback_occurred        INTEGER NOT NULL DEFAULT 0,
      failed                   INTEGER NOT NULL DEFAULT 0,
      average_grounding_support REAL,
      latency_ms               INTEGER NOT NULL DEFAULT 0,
      input_tokens             INTEGER,
      output_tokens            INTEGER,
      created_at               TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pcmpres_run ON provider_comparison_results (comparison_run_id);
  `);

  // ==========================================================================
  // ORION AI Assistant (Phase 10). Extends the Copilot audit surface with
  // per-turn assistant executions, bounded conversation state, feedback, and a
  // reproducible evaluation harness. Conversations + messages REUSE the existing
  // copilot_conversations / copilot_messages tables (no duplicate store). Only
  // bounded, sanitized metadata is stored: NO raw prompts, raw provider
  // responses, hidden chain-of-thought, raw vectors, secrets, or unrestricted
  // tool payloads.
  // ==========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_executions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id        TEXT NOT NULL,
      conversation_id       TEXT NOT NULL,
      message_id            INTEGER,
      user_id               TEXT NOT NULL,
      execution_mode        TEXT NOT NULL,       -- REAL_PROVIDER | DETERMINISTIC_FALLBACK | INSUFFICIENT_EVIDENCE | FAILED
      status                TEXT NOT NULL,       -- ACCEPTED | REAL_REJECTED | DETERMINISTIC | INSUFFICIENT_EVIDENCE | REFUSED | FAILED
      intent                TEXT NOT NULL,
      capability            TEXT,
      provider              TEXT,
      model                 TEXT,
      iteration_count       INTEGER NOT NULL DEFAULT 0,
      tool_call_count       INTEGER NOT NULL DEFAULT 0,
      retrieval_call_count  INTEGER NOT NULL DEFAULT 0,
      workflow_call_count   INTEGER NOT NULL DEFAULT 0,
      planner_execution_id  INTEGER,
      critic_execution_id   INTEGER,
      llm_execution_ids     TEXT,                -- JSON array
      retrieval_execution_ids TEXT,              -- JSON array
      grounding_status      TEXT,
      citation_count        INTEGER NOT NULL DEFAULT 0,
      evidence_count        INTEGER NOT NULL DEFAULT 0,
      context_resolved      INTEGER NOT NULL DEFAULT 0,
      quality_gate          TEXT,
      average_grounding_support REAL,            -- grounding signal, NOT confidence
      latency_ms            INTEGER NOT NULL DEFAULT 0,
      input_tokens          INTEGER,
      output_tokens         INTEGER,
      answer_card_json      TEXT,                -- bounded sanitized structured answer (for reload)
      fallback_reason       TEXT,
      failure_reason        TEXT,
      created_at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aexec_conv    ON assistant_executions (conversation_id);
    CREATE INDEX IF NOT EXISTS idx_aexec_msg     ON assistant_executions (message_id);
    CREATE INDEX IF NOT EXISTS idx_aexec_created ON assistant_executions (created_at);

    CREATE TABLE IF NOT EXISTS assistant_conversation_state (
      conversation_id       TEXT PRIMARY KEY,
      satellite_id          TEXT,
      investigation_id      INTEGER,
      report_id             INTEGER,
      planner_execution_id  INTEGER,
      critic_execution_id   INTEGER,
      citation_ids_json     TEXT,                -- JSON array (ordered)
      evidence_ids_json     TEXT,                -- JSON array
      topic                 TEXT,
      last_capability       TEXT,
      last_execution_mode   TEXT,
      summary               TEXT,                -- bounded conversation summary
      summary_source        TEXT,
      summary_message_count INTEGER NOT NULL DEFAULT 0,
      updated_at            TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES copilot_conversations(id)
    );

    CREATE TABLE IF NOT EXISTS assistant_feedback (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id               TEXT NOT NULL,
      conversation_id       TEXT NOT NULL,
      message_id            INTEGER NOT NULL,
      execution_id          INTEGER,
      rating                TEXT NOT NULL,       -- THUMBS_UP | THUMBS_DOWN
      reason                TEXT,
      comment               TEXT,                -- bounded sanitized comment
      created_at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_afeed_msg  ON assistant_feedback (message_id);
    CREATE INDEX IF NOT EXISTS idx_afeed_user ON assistant_feedback (user_id);

    CREATE TABLE IF NOT EXISTS assistant_eval_runs (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_version       TEXT NOT NULL,
      user_id               TEXT NOT NULL,
      real_provider_available INTEGER NOT NULL DEFAULT 0,
      scenario_count        INTEGER NOT NULL DEFAULT 0,
      intent_accuracy       REAL,
      context_accuracy      REAL,
      tool_selection_accuracy REAL,
      grounding_accepted_rate REAL,
      refusal_correct_rate  REAL,
      real_accepted_rate    REAL,
      fallback_rate         REAL,
      failure_rate          REAL,
      average_iterations    REAL,
      average_tool_calls    REAL,
      latency_p50_ms        INTEGER,
      latency_p95_ms        INTEGER,
      created_at            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assistant_eval_results (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      eval_run_id           INTEGER NOT NULL,
      scenario_id           TEXT NOT NULL,
      expected_intent       TEXT NOT NULL,
      actual_intent         TEXT NOT NULL,
      intent_correct        INTEGER NOT NULL DEFAULT 0,
      context_correct       INTEGER NOT NULL DEFAULT 0,
      tool_selection_correct INTEGER NOT NULL DEFAULT 0,
      grounding_valid       INTEGER NOT NULL DEFAULT 0,
      policy_correct        INTEGER NOT NULL DEFAULT 0,
      execution_mode        TEXT NOT NULL,
      status                TEXT NOT NULL,
      iteration_count       INTEGER NOT NULL DEFAULT 0,
      tool_call_count       INTEGER NOT NULL DEFAULT 0,
      latency_ms            INTEGER NOT NULL DEFAULT 0,
      notes                 TEXT,
      created_at            TEXT NOT NULL,
      FOREIGN KEY (eval_run_id) REFERENCES assistant_eval_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_aevalres_run ON assistant_eval_results (eval_run_id);
  `);

  // ==========================================================================
  // Satellite Simulation Control Center. Persists the MINIMUM required state for
  // correctness + restart visibility: session metadata/config, active/expired
  // failures, per-field telemetry configuration, and a bounded event log. Runtime
  // timer handles are NEVER persisted. On restart a RUNNING session becomes
  // INTERRUPTED (never silently resumes). Stores NO secrets and NO real telemetry
  // — all generated telemetry is explicitly SIMULATED.
  // ==========================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulation_sessions (
      id                TEXT PRIMARY KEY,
      satellite_id      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'CREATED',   -- CREATED | RUNNING | PAUSED | STOPPED | INTERRUPTED | FAILED
      telemetry_profile TEXT NOT NULL DEFAULT '{}',        -- JSON per-field config
      tick_interval_ms  INTEGER NOT NULL DEFAULT 2000,
      simulation_speed  REAL NOT NULL DEFAULT 1,
      tick_count        INTEGER NOT NULL DEFAULT 0,
      created_by        TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      started_at        TEXT,
      paused_at         TEXT,
      stopped_at        TEXT,
      FOREIGN KEY (satellite_id) REFERENCES satellites(id)
    );
    CREATE INDEX IF NOT EXISTS idx_simsess_sat    ON simulation_sessions (satellite_id);
    CREATE INDEX IF NOT EXISTS idx_simsess_status ON simulation_sessions (status);

    CREATE TABLE IF NOT EXISTS simulation_failures (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      satellite_id      TEXT NOT NULL,
      failure_type      TEXT NOT NULL,
      severity          TEXT NOT NULL DEFAULT 'MEDIUM',
      onset             TEXT NOT NULL DEFAULT 'IMMEDIATE',  -- IMMEDIATE | GRADUAL
      recovery          TEXT NOT NULL DEFAULT 'IMMEDIATE',  -- IMMEDIATE | LINEAR | GRADUAL
      duration_ticks    INTEGER,                            -- NULL = indefinite until removed
      onset_ticks       INTEGER NOT NULL DEFAULT 0,
      state             TEXT NOT NULL DEFAULT 'ACTIVE',     -- ACTIVE | EXPIRED | REMOVED
      injected_at_tick  INTEGER NOT NULL DEFAULT 0,
      expired_at_tick   INTEGER,
      params_json       TEXT NOT NULL DEFAULT '{}',         -- optional field overrides
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES simulation_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_simfail_session ON simulation_failures (session_id);
    CREATE INDEX IF NOT EXISTS idx_simfail_state   ON simulation_failures (state);

    CREATE TABLE IF NOT EXISTS simulation_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT,
      satellite_id  TEXT,
      event_type    TEXT NOT NULL,
      summary       TEXT NOT NULL,
      actor         TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_simevt_session ON simulation_events (session_id, id);
    CREATE INDEX IF NOT EXISTS idx_simevt_sat     ON simulation_events (satellite_id, id);
  `);

  // ==========================================================================
  // Dynamic satellite onboarding — additive, backward-compatible columns on the
  // existing satellites table so a manually-registered satellite can be
  // persisted WITHOUT fabricated orbital/telemetry data and flow through every
  // module. Existing rows keep their values; new columns are backfilled below.
  // No NOT-NULL drops (SQLite-safe); the legacy required columns remain and are
  // filled with honest placeholders for manual satellites.
  // ==========================================================================
  addColumnIfMissing('satellites', 'display_name', 'TEXT');
  addColumnIfMissing('satellites', 'description', 'TEXT');
  addColumnIfMissing('satellites', 'norad_catalog_id', 'TEXT');       // nullable; may be absent for manual sats
  addColumnIfMissing('satellites', 'tle_line1', 'TEXT');
  addColumnIfMissing('satellites', 'tle_line2', 'TEXT');
  addColumnIfMissing('satellites', 'inclination', 'REAL');
  addColumnIfMissing('satellites', 'orbital_period_min', 'REAL');
  addColumnIfMissing('satellites', 'launch_date', 'TEXT');
  addColumnIfMissing('satellites', 'orbit_data_state', 'TEXT');       // REAL_EXTERNAL | MANUALLY_PROVIDED | UNAVAILABLE
  addColumnIfMissing('satellites', 'data_source_mode', 'TEXT');       // NO_TELEMETRY | SIMULATED | EXTERNAL
  addColumnIfMissing('satellites', 'sim_eligible', 'INTEGER');        // 1 = may be simulated
  addColumnIfMissing('satellites', 'lifecycle_state', 'TEXT');        // ACTIVE | ARCHIVED
  addColumnIfMissing('satellites', 'origin', 'TEXT');                 // SEED | MANUAL
  addColumnIfMissing('satellites', 'created_by', 'TEXT');
  addColumnIfMissing('satellites', 'created_at', 'TEXT');
  addColumnIfMissing('satellites', 'updated_at', 'TEXT');
  addColumnIfMissing('satellites', 'archived_at', 'TEXT');

  // Manual satellite status control — additive, backward-compatible columns.
  // The legacy `status` column remains the SYSTEM-DERIVED status (written only by
  // the simulation/pipeline). These columns hold an optional persistent operator
  // override that never overwrites the derived status. Existing rows default to
  // AUTO (no override) via the backfill below.
  addColumnIfMissing('satellites', 'status_mode', 'TEXT');               // AUTO | MANUAL
  addColumnIfMissing('satellites', 'manual_status', 'TEXT');             // HEALTHY | WARNING | ALERT (only when MANUAL)
  addColumnIfMissing('satellites', 'manual_status_reason', 'TEXT');
  addColumnIfMissing('satellites', 'manual_status_updated_at', 'TEXT');
  addColumnIfMissing('satellites', 'manual_status_updated_by', 'TEXT');

  // Backfill existing satellites (seeded fleet + any prior rows) with honest
  // defaults so they remain first-class and backward compatible. These rows have
  // real orbital + simulated telemetry, so they are MANUALLY_PROVIDED + SIMULATED.
  db.exec(`
    UPDATE satellites SET
      display_name    = COALESCE(display_name, name),
      norad_catalog_id= COALESCE(norad_catalog_id, NULLIF(norad_id, '')),
      orbit_data_state= COALESCE(orbit_data_state, 'MANUALLY_PROVIDED'),
      data_source_mode= COALESCE(data_source_mode, 'SIMULATED'),
      sim_eligible    = COALESCE(sim_eligible, 1),
      lifecycle_state = COALESCE(lifecycle_state, 'ACTIVE'),
      origin          = COALESCE(origin, 'SEED'),
      created_at      = COALESCE(created_at, '${now()}'),
      updated_at      = COALESCE(updated_at, '${now()}')
    WHERE lifecycle_state IS NULL OR orbit_data_state IS NULL OR origin IS NULL;
  `);
  // Every satellite defaults to AUTO (telemetry-derived) status control.
  db.exec(`UPDATE satellites SET status_mode = COALESCE(status_mode, 'AUTO') WHERE status_mode IS NULL;`);

  // Append-only manual-status audit trail (mirrors simulation_events). Never
  // updated or deleted; captures previous/new mode + manual + effective status.
  db.exec(`
    CREATE TABLE IF NOT EXISTS satellite_status_events (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      satellite_id              TEXT NOT NULL,
      previous_mode             TEXT,
      previous_manual_status    TEXT,
      previous_effective_status TEXT,
      new_mode                  TEXT NOT NULL,
      new_manual_status         TEXT,
      new_effective_status      TEXT NOT NULL,
      reason                    TEXT,
      actor                     TEXT NOT NULL,
      actor_role                TEXT,
      created_at                TEXT NOT NULL,
      FOREIGN KEY (satellite_id) REFERENCES satellites(id)
    );
    CREATE INDEX IF NOT EXISTS idx_satstatus_sat ON satellite_status_events (satellite_id, id);
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sat_norad_catalog ON satellites (norad_catalog_id) WHERE norad_catalog_id IS NOT NULL;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sat_lifecycle ON satellites (lifecycle_state);`);

  // Phase 9 additive migration: record each chunk's embedding space key (older
  // file databases predate this column). NULL is treated as the implicit space
  // derived from the chunk's provider/model/version/dimension columns.
  addColumnIfMissing('knowledge_chunks', 'embedding_space_key', 'TEXT');

  // Safe additive migration for pre-Phase-3 file databases: add any missing
  // hybrid-diagnostics columns to retrieval_executions (idempotent).
  addColumnIfMissing('retrieval_executions', 'vector_candidate_count', 'INTEGER');
  addColumnIfMissing('retrieval_executions', 'bm25_candidate_count', 'INTEGER');
  addColumnIfMissing('retrieval_executions', 'fused_candidate_count', 'INTEGER');
  addColumnIfMissing('retrieval_executions', 'reranked_candidate_count', 'INTEGER');
  addColumnIfMissing('retrieval_executions', 'fusion_k', 'INTEGER');
  addColumnIfMissing('retrieval_executions', 'reranker_version', 'TEXT');
  addColumnIfMissing('retrieval_executions', 'evaluation_run_id', 'INTEGER');
}

/** Add a column only if it does not already exist (safe, idempotent migration). */
function addColumnIfMissing(table: string, column: string, typeDecl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDecl};`);
  }
}

/** Small helper to run a function inside a transaction with rollback on error. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
