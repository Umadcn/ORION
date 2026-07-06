# AI Assistant — Relevance Gate & Abstention

`assistantRelevance.ts` replaces "accept top-K" with a deterministic post-retrieval
relevance gate. Every candidate passage is classified:

- **ACCEPTED** — may support a factual answer + citation.
- **WEAK** — may trigger one bounded query refinement; never a citation.
- **REJECTED** — never a source/citation.

## Scoring

For a passage vs. the intent-aware query terms (`meaningfulTerms` = tokenized,
length ≥ 3, generic question filler removed):

- `overlap` = shared meaningful terms; `coverage` = overlap / |queryTerms|.
- **ACCEPTED** if `overlap ≥ 2`, or `overlap ≥ 1 && coverage ≥ 0.15`.
- **WEAK** if `overlap == 1` but coverage below threshold.
- **REJECTED** otherwise.

Thresholds (`DEFAULT_MIN_OVERLAP = 2`, `DEFAULT_MIN_COVERAGE = 0.15`) are bounded
constants and overridable per call.

## Identifier-aware filtering

When the question is scoped to a resolved satellite and the route is NOT historical/
comparison, a passage that explicitly names a DIFFERENT satellite id (and not the
resolved one) is **REJECTED** with reason `IDENTIFIER_CONFLICT:<id>`. This is what
prevents the `ORION-6`→`ORION-3`-documents failure and stops cross-satellite
document leakage. Historical/comparison routes pass `allowIdentifierConflicts`.

## Abstention

If no passage is ACCEPTED after the bounded refinement loop, the assistant abstains:

> "I couldn't find sufficiently relevant mission knowledge to answer that question."

status `INSUFFICIENT_EVIDENCE`. It never dumps the nearest documents, never
fabricates an answer, and never cites REJECTED passages. Rejected passages are
excluded from citations and from the (collapsed) source panel.

## Not confidence

Overlap / coverage / grounding-support / rerank scores are **relevance / grounding
signals, never confidence.** The UI labels them accordingly (`scoreLabel`).
