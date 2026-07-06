# Grounded Generation Architecture (Phase 4)

ORION's first genuine retrieval-augmented LLM generation path — a **reusable**
grounded-generation subsystem underneath a single product use case
(read-only investigation briefing).

## Non-negotiable truths

- **The deterministic RCA remains AUTHORITATIVE.** Generation summarizes; it never
  replaces anomaly detection, evidence scoring, root-cause selection, severity,
  lifecycle transitions, approvals, or satellite control.
- **Retrieved documents are supporting context only**, and are treated as
  **untrusted data**, never instructions.
- **DETERMINISTIC_FALLBACK output is not real LLM output.** Generation status is
  tracked separately from the Phase 1 provider execution mode.
- **LocalHashEmbedding is not a neural semantic embedding model.**
- **Grounding support is a lexical score — not RCA confidence, not LLM confidence.**
- **Retrieval scores are not confidence.**
- **Prompt-injection defenses reduce risk but do not guarantee prevention.**
- **No operational agent uses LlmRunner. No Mission Copilot. No tool calling. No
  autonomous action.** `LlmRunner` is invoked only by `GroundedGenerationService`.

## Pipeline

```
investigation + deterministic evidence + deterministic RCA
        + Phase 3 hybrid retrieval (HYBRID_RRF_RERANK)
   → bounded grounding context builder (trusted facts vs untrusted docs)
   → versioned prompt builder (injection-delimited)
   → LlmRunner (structured output, timeout, retry, token bounds, fallback, audit)
   → strict schema validation
   → citation validation → evidence validation
   → claim-level grounding validation
   → deterministic policy validation
   → quality gate (fixed precedence)
   → ACCEPT  or  safe deterministic fallback  or  reject
   → persisted grounded-generation audit
   → read-only briefing API
```

## Subsystem layout

- `src/generation/` (reusable): `types`, `schemas`, `contextBuilder`,
  `promptBuilder`, `citationValidator`, `evidenceValidator`, `groundingValidator`,
  `policyValidator`, `qualityGate`, `groundedGenerationService`, `repository`.
- `src/briefing/` (use case): `types`, `prompt`, `deterministicBriefingFallback`,
  `briefingService`.
- APIs: `src/api/briefing.ts`, `src/api/generation.ts`.

## Trusted-source hierarchy

1. **Deterministic system facts** — investigation, RCA (`authoritative_root_cause`,
   severity, deterministic confidence), and deterministic evidence. Authoritative.
2. **Retrieved mission documents** — supporting knowledge only, delimited as
   untrusted data in the prompt.

## Context builder

Separates trusted facts from untrusted retrieved chunks. Bounds: max context
chars, max evidence items, max retrieval chunks, max chars per source — all
config-driven with deterministic truncation. Never includes secrets, credentials,
Authorization headers, raw embedding vectors, unrestricted DB rows, or other
investigations' data. Places citation IDs adjacent to retrieved text and evidence
IDs adjacent to deterministic evidence. Returns diagnostics (included/excluded
counts, injection flags, total chars).

## Retrieval query construction

Deterministic and bounded, built by the briefing layer from satellite ID,
subsystem (derived from the authoritative root cause), anomaly types, the root-
cause label, and key evidence terms. The LLM never invents the retrieval query.
Uses Phase 3 `HYBRID_RRF_RERANK`. A normal retrieval audit is persisted.

## Prompt builder + versioning

System prompt (`orion-investigation-briefing-v1`) states the authority hierarchy,
marks retrieved documents as untrusted data whose embedded instructions must be
ignored, forbids operational commands / action claims / approve-reject-resolve /
secret disclosure, and requires schema-only output with citations. The prompt
version is persisted through LlmRunner and the generation audit.

## Prompt-injection defense (defense-in-depth)

- Retrieved content is explicitly delimited (`<<<BEGIN/END_UNTRUSTED_RETRIEVED_DOCUMENTS>>>`).
- The system prompt instructs the model to ignore instructions inside documents.
- The context builder scans chunks for instruction-like patterns and, when
  `ORION_GENERATION_INJECTION_FILTER_ENABLED` (default on), **excludes** flagged
  chunks and records `injection_flag_count`.
- Retrieved content is bounded and can never modify system instructions.
- This reduces risk; it does not guarantee prevention.

## LlmRunner integration

`GroundedGenerationService` is the ONLY generation caller of the LLM, exclusively
through `LlmRunner` (no direct provider calls). Structured output + strict schema,
bounded input/output, timeout, retries, deterministic fallback, and the Phase 1
LLM execution audit are all preserved. Correlation ID, investigation ID, request
type (use case), and prompt version are propagated. The linked `llm_execution_id`
is recorded in the generation audit.

## Deterministic fallback design (documented choice)

The service builds the **domain-specific deterministic briefing** up front and
passes it to LlmRunner as `fallbackSeed`. When the runner returns
`DETERMINISTIC_FALLBACK` (e.g. no real provider), the service uses that domain
briefing as the candidate — guaranteeing a schema-correct, grounded briefing —
and labels the outcome `DETERMINISTIC_FALLBACK_ACCEPTED`. If a real-provider
output is **rejected** by the quality gate, the service safely degrades to the
deterministic briefing (recording `fallback_reason = REAL_REJECTED:<decision>`)
rather than emitting ungrounded content. Fallback output is never labeled real.
Both real and fallback candidates pass through the **same** validation pipeline.

## Validators

- **Citation** — syntax valid, present in the investigation context, resolves to a
  stored chunk. Rejects malformed / fabricated / out-of-context citations.
- **Evidence** — evidence ID exists, belongs to the investigation, and was in
  context. Rejects fabricated / cross-investigation evidence.
- **Grounding (claim-level)** — for each factual claim: has ≥1 citation, cited
  chunks are in context, and the claim's significant terms have **lexical support**
  in the cited chunk text at or above `ORION_GENERATION_MIN_GROUNDING_SUPPORT`
  (mission-identifier aware). Also enforces `authoritative_root_cause` == the
  deterministic RCA. Support score is reported separately and is not confidence.
- **Policy** — rejects operational commands, action-executed claims, approve/
  reject/resolve decisions, root-cause contradiction, fabricated satellite/
  investigation/citation IDs, array-bound violations, and secret-shaped strings.

## Quality gate precedence

`context sufficiency → schema → citation → evidence → grounding → policy → ACCEPT`.
Fixed, documented order; no provider-specific bypass; real and fallback outputs
use the same gate.

## Context sufficiency gate

Before any provider call: requires a deterministic RCA, a satellite, ≥1 evidence
item, and ≥ `ORION_GENERATION_MIN_RETRIEVAL_CHUNKS` retrieved chunks. If
insufficient → `REJECTED_CONTEXT_INSUFFICIENT`, no provider call, audit persisted,
no fabricated briefing.

## Generation audit (`grounded_generation_executions`)

One row per attempt: correlation/investigation IDs, use case, generation status,
linked `llm_execution_id`, provider execution mode/provider/model, prompt version,
retrieval execution ID + mode, context/evidence/citation/excluded/injection
counts, per-validator booleans, claim counts, average grounding support, latency,
fallback/rejection reasons. **No prompts, no raw retrieved chunks, no raw model
responses, no secrets, no embeddings.**

## Configuration

`ORION_GENERATION_MAX_CONTEXT_CHARS`, `_MAX_EVIDENCE_ITEMS`, `_MAX_RETRIEVAL_CHUNKS`,
`_MAX_TEXT_PER_SOURCE`, `_RETRIEVAL_TOP_K`, `_MIN_RETRIEVAL_CHUNKS`,
`_MIN_GROUNDING_SUPPORT`, `_MAX_CLAIMS`, `_INJECTION_FILTER_ENABLED` — all bounded,
safe offline defaults, exposed (sanitized) via config description.

## Limitations

Grounding is lexical (not semantic); the deterministic fallback is a faithful
summary of retrieved context, not an analytical narrative; the offline default
always produces `DETERMINISTIC_FALLBACK_ACCEPTED` (the real-provider path is
mock-tested). Injection defense is best-effort. No RAG answer chat, no copilot,
no agent wiring — deferred by design.
