# AI Assistant — Entity Extraction & Resolution

## Extraction (independent of existence)

`extractSatelliteCandidates(text)` (in `intentRouter.ts`) recognizes tokens that
LOOK like a satellite id — letters + hyphen segments + **at least one digit** —
using whole-token boundaries `(?<![A-Z0-9])…(?![A-Z0-9])`. It excludes
`ORION-KB-*` citation ids and hyphenated non-identifiers (`READ-ONLY`, `FOLLOW-UP`).
Dynamic: it matches `ORION-6`, `SAT-NEW-001`, `SATELLITE-X9`, not just `ORION-N`.

`AssistantEntityRefs` also carries investigation/report/citation ids, a citation
ordinal, and a `referencesPrevious` flag for follow-ups.

## Resolution BEFORE retrieval (mandatory)

For a `SATELLITE_LOOKUP`, the service resolves the candidate against authoritative
storage via `resolveSatelliteExact(candidate)` (exact, uppercased — **never
substring**) BEFORE any retrieval:

- **Exists** → routed to `SATELLITE_STATUS` and answered from structured data.
- **Does not exist** → a definitive NOT_FOUND answer:
  > "I couldn't find a registered satellite with ID ORION-6. Registered satellites
  > include ORION-1, ORION-2, …" (registry hint from actual DB rows, bounded to 8).
  Zero retrieval, zero citations, zero rich content. The satellite is never
  fabricated, and no ORION-3 documents are surfaced because tokens overlap.

## Non-substring guarantees (tested)

- `ORION-6` never matches `ORION-3`.
- `ORION-1` never matches `ORION-10`.
- `SAT-NEW-001` never matches `SAT-NEW-0010`.

These hold in both extraction (`extractSatelliteCandidates`) and resolution
(`findSatelliteIdInText` uses the same whole-token boundaries; `resolveSatelliteExact`
does an exact keyed lookup).

## Model-supplied entities

When the real provider returns a `satellite_id`, it is accepted only if it resolves
to a persisted satellite (`findSatelliteIdInText`), otherwise the deterministic
extraction stands. The model can never invent a satellite that answers as real.
