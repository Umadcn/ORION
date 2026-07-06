# Reflection / Revision Loop (Phase 7)

A **strictly bounded** reflection loop: the Critic reviews a Planner analysis; on
REVISE, a **separate** deterministic RevisionService produces a revised analysis
that must pass the full validation pipeline before the Critic re-evaluates it.
There is no unbounded self-reflection and no recursive agent spawning.

## Loop

```
initial analysis → Critic review → ACCEPT | REVISE | REJECT
  if REVISE, repeat up to ORION_CRITIC_MAX_REVISION_ATTEMPTS:
    RevisionService(analysis, review)  → revised candidate   (deterministic)
    validate candidate: schema + citation + evidence + grounding + policy + RCA
    if invalid → stop (REVISION_VALIDATION_FAILED)
    if candidate == current (hash) → stop (REPEATED_ANALYSIS)
    Critic re-evaluate candidate
    if ACCEPT → REVISED_ACCEPTED (stop)
    if REJECT → REJECTED (stop)
    if review unchanged (hash) → stop (REPEATED_REVIEW)
  → REVISION_LIMIT_REACHED if attempts exhausted while still REVISE
```

## Stop conditions (all bounded)

- ACCEPT / REJECT reached;
- `ORION_CRITIC_MAX_REVISION_ATTEMPTS` reached;
- `ORION_CRITIC_MAX_CALLS` reached (CALL_LIMIT);
- `ORION_CRITIC_MAX_EXECUTION_MS` exceeded (TIMED_OUT);
- validation failure with no safe revision (REVISION_VALIDATION_FAILED);
- repeated identical analysis (REPEATED_ANALYSIS — deterministic SHA-256 hash);
- repeated identical critique (REPEATED_REVIEW — deterministic SHA-256 hash);
- budget exhaustion.

Deterministic stable hashing (`stableHash`, sorted-key canonical JSON + SHA-256)
drives repeated-output detection; the same inputs always produce the same hashes.

## RevisionService — separate + deterministic

The Critic never mutates the analysis. The RevisionService applies ONLY safe,
deterministic transforms keyed off the review:

- remove unsupported / contradicting findings (by claim index);
- strip invalid citation / evidence associations (IDs already in context);
- soften overstated / absolute language;
- add missing limitations / knowledge gaps (from the deterministic Planner gaps
  or a generic advisory note — never invented facts);
- add explicit uncertainty language;
- preserve the authoritative root cause EXACTLY.

It NEVER invents facts, citations, or evidence IDs; NEVER changes the RCA or
deterministic confidence; NEVER produces operational commands, write actions,
SQL, URLs, filesystem paths, or shell commands. The revised candidate always
re-enters the full validation pipeline before re-review, so a revision that would
break grounding, citations, evidence, policy, or RCA preservation is rejected.

## Statuses

`ACCEPTED`, `REVISION_REQUIRED`, `REVISED_ACCEPTED`, `REJECTED`, `TIMED_OUT`,
`REVISION_LIMIT_REACHED` (plus `CREATED`/`RUNNING`/`FAILED` for completeness).

## Audit

Each attempt writes a `critic_revision_attempts` row: attempt number, input
analysis hash, critique hash, output analysis hash, validation status, critic
decision after, issue count after, latency, and failure reason. Bounded summaries
only — no raw prompts, no hidden reasoning, no raw model responses, no vectors,
no secrets.
