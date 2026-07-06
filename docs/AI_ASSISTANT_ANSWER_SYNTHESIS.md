# AI Assistant — Answer Synthesis & Alignment

## Synthesis (no chunk-dumping)

The assistant never renders raw tool payloads or raw retrieved chunks as the final
answer. `AssistantAnswer` carries a direct `summary` first, then bounded supporting
`claims` (each cited/evidenced), `citations`, `evidence_ids`, `limitations`,
`suggested_followups`, and validated `rich_content` cards.

- **Structured** (telemetry/alerts/status/investigation/evidence/report): the
  summary states the fact directly (e.g. "ORION-3's latest telemetry shows battery
  at 97.5%, temperature 24.5 °C, signal −93.9 dBm, power 674.8 W").
- **Mission knowledge**: a synthesized lead sentence ("Based on N relevant
  mission-knowledge passages…") followed by short cited excerpts from **ACCEPTED**
  passages only — never a full-chunk dump.
- **Comparison**: a per-field `A vs B` synthesis from both resolved satellites.
- **Conversational / NOT_FOUND / clarification / abstention / refusal**: a concise
  direct message with **no** citations.

## Real-provider synthesis

When a verified provider is available, the bounded tool-calling loop produces a
strict structured `AssistantAnswer`. It is accepted only after passing the SAME
quality gate (schema + citation + evidence + grounding + policy). A rejected real
answer is recorded `REAL_REJECTED` and degraded to deterministic synthesis. The
model cannot turn REJECTED passages into sources, cannot pick tools outside the
capability allowlist, and cannot bypass routing. Failed/degraded real output is
never labeled `REAL_PROVIDER`.

## Answer↔question alignment validation

`answerAlignment.validateAlignment(intent, answer, {hasCitations})` runs on the final
answer (real or deterministic) and is conservative — it rejects only clear
mismatches:

- A non-abstaining `MISSION_KNOWLEDGE_SEARCH` answer MUST have citations.
- A conversational answer (GREETING/THANKS/CAPABILITIES/OUT_OF_SCOPE) must NOT carry
  citations.
- Empty answers are rejected.
- Explicit abstentions / NOT_FOUND / refusals always align (honest answers).

On failure the answer is replaced by a safe `INSUFFICIENT_EVIDENCE` response
(`terminationReason = ALIGNMENT_FAILED:<reason>`) rather than returning a mismatch.
