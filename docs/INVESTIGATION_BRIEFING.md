# Investigation Briefing (Phase 4)

The single product use case built on the reusable grounded-generation subsystem
(see `docs/GROUNDED_GENERATION_ARCHITECTURE.md`). It produces a **read-only**,
grounded, cited briefing for an existing investigation. It never mutates state.

## Endpoint

```
POST /api/investigations/:id/briefing
```

- Authenticated. RBAC matches investigation read access — any authenticated role
  (Analyst, Director, Admin) may request a briefing.
- The request body is **ignored**: no arbitrary prompt, system prompt, retrieval
  query, provider, model, or tools are accepted.
- `404` if the investigation does not exist; `409` if it has no completed
  deterministic root-cause analysis (lifecycle gate); `400` for a malformed id.
- Never approves/rejects/resolves, never alters the RCA, never commands hardware.

### Response

```jsonc
{
  "investigationId": 1,
  "briefing": { /* GeneratedBriefing, or null if rejected */ },
  "generationStatus": "DETERMINISTIC_FALLBACK_ACCEPTED",
  "providerExecutionMode": "DETERMINISTIC_FALLBACK",
  "retrievalMode": "HYBRID_RRF_RERANK",
  "promptVersion": "orion-investigation-briefing-v1",
  "citations": [ { "citationId": "ORION-KB-...", "documentId": 3, "title": "..." } ],
  "generationDiagnostics": { /* bounded counts, validator booleans, avg grounding support */ },
  "correlationId": "…",
  "disclaimer": "Advisory read-only briefing. …"
}
```

No secrets, no raw prompt, no raw model response, no raw vectors are ever returned.

## GeneratedBriefing schema

`title`, `summary`, `situation[]` (claim + citation_ids), `root_cause`
(authoritative_root_cause + explanation + citation_ids), `evidence_summary[]`
(claim + evidence_ids + citation_ids), `recommended_review_items[]`
(item + citation_ids), `limitations[]`. There are deliberately **no** fields for
operational commands, autonomous actions, or approve/reject/resolve decisions.
`authoritative_root_cause` always equals the deterministic RCA.

## Flow

1. Load investigation; require a completed deterministic RCA (else `409`).
2. Load deterministic evidence + satellite.
3. Build a deterministic, bounded retrieval query (satellite, subsystem, anomaly
   types, root-cause label, key evidence terms).
4. Run Phase 3 `HYBRID_RRF_RERANK` retrieval (retrieval audit persisted).
5. Build the bounded grounding context (trusted facts vs untrusted docs; injection
   filtering).
6. Build the deterministic domain fallback + versioned prompt.
7. Delegate to `GroundedGenerationService` (uses `LlmRunner`; LLM audit persisted
   when a provider runs).
8. Validate through the shared quality pipeline; accept or safely fall back.
9. Persist the grounded-generation audit; return the read-only response.

## Operating modes

- **Offline default (no real provider):** briefings are produced by the
  deterministic fallback and labeled `DETERMINISTIC_FALLBACK_ACCEPTED`. This is
  **not** real LLM output.
- **Real provider configured (`ORION_LLM_*`):** a valid, grounded model output is
  labeled `REAL_PROVIDER_ACCEPTED`; a rejected model output safely degrades to the
  deterministic fallback (`fallback_reason = REAL_REJECTED:<decision>`).
- **Rejections:** `REJECTED_CONTEXT_INSUFFICIENT` (no usable grounding context;
  provider not called), or — only if even the fallback fails — a specific
  `REJECTED_*` status. `FAILED` if the provider fails and fallback is disabled.

## Audit

Every attempt writes a `grounded_generation_executions` row (Director/Admin read
via `GET /api/generation/executions[/:id]`). Retrieval and LLM audits are also
persisted through their existing Phase 2/3/1 paths.

## Reminders

Grounding support is lexical, not confidence. Retrieval scores are not confidence.
The deterministic RCA is authoritative; retrieved documents are supporting context
only. No operational agent uses `LlmRunner`; there is no Mission Copilot, no tool
calling, and no autonomous action in Phase 4.
