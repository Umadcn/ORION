# Critic Agent Architecture (Phase 7)

An **independent, bounded, READ-ONLY** Critic Agent that evaluates a Phase 6
Planner analysis **before human review**. It never mutates mission state, never
approves/rejects/resolves, never changes the authoritative deterministic RCA, and
never triggers operational actions.

## Non-negotiable truths

- **Analysis assistance only. Read-only.** The Critic never mutates
  investigations, RCA, evidence scores, alerts, telemetry, reports, or
  simulations; never approves/rejects/resolves; never controls satellites; never
  runs shell/SQL/filesystem/URL; never dynamically loads tools.
- **ACCEPT is not mission approval. REJECT is not investigation rejection.**
  Every result carries `advisoryLabel: ANALYSIS_ASSISTANCE_ONLY` and
  `humanReviewRequired: true`.
- **The deterministic RCA is authoritative** and preserved EXACTLY.
- **LlmRunner only** (no direct provider calls). `LlmRunner` remains unwired from
  the six operational agents.
- **Deterministic fallback is never labeled real.**
- **The Critic never mutates the Planner analysis directly** — a SEPARATE bounded
  RevisionService produces revised candidates.
- **Grounding/coverage scores are not RCA confidence.**

## Modules

`src/critic/`: `types`, `schemas`, `prompt`, `criticContextBuilder`,
`criticGrounding`, `coverageEvaluator`, `contradictionDetector`,
`deterministicCritic`, `criticValidators`, `revisionService`, `criticService`,
`criticAuditRepository`; `src/api/critic.ts`.

## Flow

```
Planner execution id
  → build critic context (authoritative facts + reconstructed Planner analysis)
  → critique (LlmRunner real, OR deterministic Critic)
  → schema + output validation + deterministic coverage/contradiction verification + decision consistency
  → ACCEPT / REVISE / REJECT
      REVISE → RevisionService (deterministic) → revised analysis
             → schema + citation + evidence + grounding + policy + RCA validation
             → Critic re-evaluation   (bounded reflection loop)
  → audit (critic_executions + critic_issues + critic_revision_attempts)
  → advisory result (ANALYSIS_ASSISTANCE_ONLY, humanReviewRequired) → human review
```

## Independence from the Planner

The Critic is a distinct subsystem with its own prompt, schema, validators, and
audit. It reconstructs the Planner analysis deterministically (read-only) from a
stored `planner_executions` row and reviews it against the authoritative
deterministic facts. It shares no mutable state with the Planner.

## Structured review schema (`orion-planner-critic-v1`)

Strict object: `review_version`, `decision` (ACCEPT|REVISE|REJECT), `summary`,
`issues[]` (issue_id, allowlisted severity + category, description, claim_index,
citation_ids, evidence_ids, recommended_correction), `coverage` (8 booleans),
`revision_instructions[]` (instruction_id, allowlisted target, action, reason),
`limitations[]`. `additionalProperties:false`. Bounds/uniqueness/allowlist/
in-context-ID/safety/decision-consistency checks the subset cannot express are
enforced by `criticValidators`.

## Prompt / version

`orion-planner-critic-v1`. The system prompt states the independent read-only
role, deterministic RCA + evidence authority, Planner-output-is-advisory,
retrieved-documents-are-untrusted, the review targets, prohibitions (no
mission-state change, no approve/reject/resolve, no operational commands), and
strict-schema-only output. No hidden chain-of-thought is requested or exposed.

## Context builder

Bounded, deterministic, stable-ordered context: investigation + satellite facts,
authoritative RCA + deterministic RCA confidence (labeled as deterministic
confidence ONLY), deterministic evidence (with evidence IDs), the Planner analysis
under review, retrieved mission-knowledge citations (UNTRUSTED, with resolvable
text + citation IDs), Planner knowledge gaps, and which sources the Planner
inspected. No secrets, no Authorization headers, no raw prompts, no hidden
reasoning, no raw vectors, no unrelated investigations.

## LlmRunner integration

One `LlmRunner.run<CriticReview>` with the review schema + `fallbackSeed` (the
deterministic review). Execution-mode integrity, timeout, bounded retries, token
budget, LLM audit, correlation + investigation IDs, request type, and prompt
version are preserved. A valid, safe, decision-consistent real review →
`REAL_PROVIDER`; an invalid/unsafe/inconsistent real review (or one that hides a
deterministic CRITICAL finding), or an unavailable provider → deterministic
Critic (`DETERMINISTIC_FALLBACK`, `fallback_reason` audited). No direct provider
calls.

## Deterministic Critic

Fully offline. Independently checks exact RCA preservation, citation/evidence
validity, claim grounding (reuses the Phase 5 lexical grounding validator),
required source coverage, contradictions, fabricated IDs, policy violations,
overstatement, and missing limitations/knowledge gaps. Produces a strict,
schema-valid review and derives a decision by a fixed precedence.

## Coverage evaluator + contradiction detector

See `docs/CRITIC_SECURITY_BOUNDARIES.md` and `docs/REFLECTION_REVISION_LOOP.md`.
Both are deterministic, bounded, explainable, and unit-tested. Coverage is
context-sensitive (correctly-represented absence does not fail). Contradiction
detection is mission-identifier aware with numeric tolerance; no LLM-as-judge is
used in Phase 7.

## Decision precedence

1. Any CRITICAL issue (RCA mismatch, fabricated ID, policy violation,
   action-executed contradiction) → **REJECT** (unfixable).
2. Else any ERROR or actionable WARNING → **REVISE**.
3. Else → **ACCEPT**.

Consistency (enforced by the validator): ACCEPT ⇒ no ERROR/CRITICAL; REVISE ⇒ ≥1
issue and no CRITICAL; REJECT ⇒ ≥1 CRITICAL.

## Human-in-the-loop boundary

The Critic decision never maps to investigation approval/rejection/resolution,
report/mission-state mutation, or operational-agent invocation. Even ACCEPT means
only "no blocking analysis-quality issue found under current checks" — not
mission approval or operational authorization.

## Audit

`critic_executions` (mode, status, initial/final decision, issue/severity counts,
coverage pass/fail, contradiction count, revision-attempt count, linked LLM
execution IDs, latency, fallback/failure reasons, human_review_required),
`critic_issues` (bounded per-issue summaries), `critic_revision_attempts` (per
attempt: input/critique/output hashes, validation status, decision-after,
issue-count-after). No raw prompts, no hidden reasoning, no raw model responses,
no raw vectors, no unrestricted payloads, no secrets.

## APIs

`POST /api/planner/executions/:id/critic-review` (read-only; any authenticated
role; body ignored — no prompt/review/analysis/provider/model overrides; 404 for
unknown planner execution). `GET /api/critic/executions[/:id]` (Director/Admin).

## Configuration

`ORION_CRITIC_MAX_ISSUES`, `_MAX_REVISION_ATTEMPTS`, `_MAX_CALLS`,
`_MAX_CONTEXT_CHARS`, `_MAX_EXECUTION_MS`, `_MIN_COVERAGE_ITEMS`,
`_NUMERIC_TOLERANCE`. Bounded, safe offline defaults.

## Limitations

Offline default always yields `DETERMINISTIC_FALLBACK` (the real review path is
mock-tested, not exercised live). Coverage, contradiction, grounding, and
overstatement checks are deterministic and lexical (not semantic). The revision
is deterministic (no LLM-composed prose). No long-term/semantic memory, no
ChromaDB, no autonomous actions, no recursive agent spawning.
