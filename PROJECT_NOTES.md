# PROJECT ORION — Project Notes (explain-from-scratch)

This document assumes you know almost nothing and explains Project ORION from the ground up, then gives 50+ evaluator questions with answers. It describes the **actual implemented application**.

---

## Part A — The big picture

### What is Project ORION?
A web application that **simulates** a fleet of 5 satellites, watches their health data, and — when something goes wrong — automatically runs a team of six software "agents" that investigate the problem, figure out the most likely cause, and recommend actions. A human (the "Mission Director") approves the conclusion, then a report is generated. It is a **simulation and decision-support tool** — it never touches a real satellite.

### What problem does it solve?
When a satellite misbehaves, operators must sift through lots of telemetry, add outside context (space weather, orbit data), reason about the cause, and act — fast, with an audit trail. ORION shows how that whole loop can be automated and made explainable.

### Why did we build it?
To demonstrate a realistic, end-to-end **multi-agent** system with detection, investigation, explainable root-cause analysis, human-in-the-loop review, and reporting — running entirely offline on a normal laptop.

### Background concepts (plain English)
- **Satellite:** a spacecraft in orbit. Here, simulated.
- **Telemetry:** health/status measurements a satellite reports (battery %, temperature, power draw, signal strength, altitude, etc.).
- **Anomaly detection:** automatically noticing when a measurement crosses a safe threshold.
- **Backend:** the server-side program that holds the logic and data (Node.js here).
- **Frontend:** the part you see in the browser (React here).
- **Database:** where data is stored (SQLite file here).
- **API:** a defined way for the frontend to ask the backend for data ("Application Programming Interface").
- **REST:** a common style of API using URLs + HTTP verbs (GET/POST/PUT).
- **JSON:** a simple text format for data — the language the API speaks.
- **Polling:** the frontend re-asks the backend every few seconds to stay current (instead of WebSockets).
- **Multi-agent system:** several focused programs ("agents"), each with one job, working in sequence.
- **Why agents?** Separation of concerns — each agent is small, testable, and its work is recorded, so the whole investigation is transparent.
- **AI agent vs API:** an API just returns data when asked; an agent *does a task* (analyzes, decides, produces structured output) and records its execution. ORION's agents are deterministic (rule/scoring based), not an LLM.

---

## Part B — How ORION works

### The simulator
Creates 5 satellites (ORION-1…5). While "running", every ~2 seconds it generates a new telemetry sample per satellite. Normal telemetry gently oscillates around realistic baselines. You can **inject a failure** into one satellite; the failure changes its telemetry **progressively** (e.g. power failure drains the battery and raises power draw over time).

### The five telemetry fields that matter
`temperature_c`, `battery_percent`, `signal_strength_dbm`, `power_consumption_w`, `altitude_km` (plus velocity/lat/long).

### The five failure types
`POWER_SYSTEM_FAILURE`, `THERMAL_CONTROL_FAILURE`, `COMMUNICATION_FAILURE`, `ORBIT_DEVIATION`, `BATTERY_DEGRADATION`.

### The five anomaly rules (defaults, configurable in Settings)
| Anomaly | Rule |
|---|---|
| HIGH_TEMPERATURE | temperature > 75 °C |
| LOW_BATTERY | battery < 25 % |
| COMMUNICATION_LOSS | signal < −110 dBm |
| ABNORMAL_POWER_CONSUMPTION | power > 850 W |
| ORBIT_DEVIATION | altitude deviates > 25 km from baseline |
Each rule requires the condition to **persist across multiple samples** (default 3) to avoid noise.

### Alerts
When a rule fires, an alert is created — but **deduplicated**: no new alert while one of the same type is already ACTIVE, and a cooldown prevents alert storms every cycle.

### Investigations
When anomalies persist and no investigation is open for that satellite, one is created automatically and the **orchestrator** runs the agent pipeline.

### The six agents (what each does, in/out)
1. **Telemetry Monitoring Agent** — reads the recent telemetry window; computes trends, a health score, and threshold violations → `TelemetryObservation`.
2. **Anomaly Detection Agent** — turns violations into classified anomalies with severity → `AnomalyDetectionResult`.
3. **Space Weather Agent** — asks the NOAA adapter (offline fixture) for space weather; decides if it's relevant → `SpaceWeatherEvidence` (with provenance).
4. **Orbit Intelligence Agent** — asks the CelesTrak adapter (offline fixture) for orbital/TLE context; decides if an orbital deviation is relevant → `OrbitEvidence`.
5. **Root Cause Analysis Agent** — combines everything and runs the deterministic scoring engine → `RootCauseAnalysisResult` (cause, confidence, severity, explanation, supporting/contradicting evidence, recommendations, scoring breakdown).
6. **Report Generation Agent** — assembles a structured, printable report and pulls scientific references from the OpenAlex adapter (offline fixture) → `InvestigationReport`.

Every agent writes an `AgentExecution` record (status, timing, summaries, errors), shown as the **Agent Execution Timeline**.

### The orchestrator
Runs the agents **in sequence** for reliability, passes typed outputs along, stores evidence and results, updates the investigation's state, and continues even if an adapter fails (using fixture fallback and recording it).

### Evidence
Each piece of evidence has a `source_type` (TELEMETRY, ANOMALY_RULE, SPACE_WEATHER, ORBIT_DATA, SYSTEM), a summary, a reliability score, whether it supports the root cause, and — for external data — provenance (`mode`, `source_url`, `cached`, `fallback_used`). This is *why* the UI can show the reasoning.

### External data adapters & offline fixtures
- **NOAA SWPC** → space weather (Kp index, geomagnetic condition).
- **CelesTrak** → orbital/TLE data per satellite.
- **OpenAlex** → scientific references for the report.
All default to **OFFLINE_FIXTURE** mode (bundled JSON). Live mode is disabled; if it were enabled and failed, the adapter falls back to the fixture and marks `fallback_used`. A small **TTL cache** avoids repeated reads.

### The deterministic Root Cause Analysis engine
A **knowledge base** maps each anomaly to candidate causes with weights, e.g.:
- `ABNORMAL_POWER_CONSUMPTION` → +0.45 `PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION`
- `LOW_BATTERY` → +0.35 `BATTERY_DEGRADATION`, +0.20 `PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION`
- `COMMUNICATION_LOSS` → +0.50 `COMMUNICATION_SUBSYSTEM_FAILURE`
- `ORBIT_DEVIATION` → +0.55 `ORBITAL_PERTURBATION`

Context adjusts scores: a **severe geomagnetic storm** boosts `SPACE_WEATHER_INTERFERENCE`; **quiet** space weather penalizes it; a confirmed orbit deviation boosts `ORBITAL_PERTURBATION`, a nominal orbit penalizes it. Scores are **normalized**; the highest wins.

**Confidence** = deterministic function of the winner's share and its margin over the runner-up, clamped to 50–97% (never claims certainty). **Severity** is the max anomaly severity, escalated to CRITICAL when confidence ≥ 90% and already HIGH. **Same evidence ⇒ same conclusion**, always — and the whole scoring breakdown is visible.

### Human-in-the-loop
The investigation stops at `WAITING_FOR_REVIEW`. The Mission Director **approves** or **rejects** (with a confirmation modal). Only then can it be **resolved**. Recommendations are advisory — nothing is ever sent to a real satellite. Invalid transitions (e.g. resolve before review) are blocked (HTTP 409).

### Database tables & relationships
`satellites` → has many `telemetry`, `alerts`, `investigations`. An `investigation` → has many `evidence`, `recommendations`, `agent_executions`, and one/many `reports`; `alerts` link to an investigation. `system_settings` holds thresholds.

### Backend folder structure
`backend/src/`: `agents/` (6 agents + base), `analysis/` (rules, scoring, knowledge base, engine), `integrations/` (adapters + fixtures + cache), `orchestrator/`, `services/` (telemetry, anomaly, investigation, simulation, report, settings), `api/` (routes), `seed/`, `db.ts`, `config.ts`, `types.ts`, `index.ts`.

### Frontend folder structure
`frontend/src/`: `pages/` (11 pages), `components/` (shell, ui primitives, domain components, chart, modal), `hooks/` (polling), `lib/` (formatting), `api/client.ts`, `types.ts`.

### Every frontend page
Dashboard, Satellites, Satellite Details, Telemetry, Alerts, Investigations, Investigation Details, Simulation, Reports, Report Details, Settings.

---

## Part C — Explaining it to a trainer

### 2-minute explanation
"ORION simulates 5 satellites producing telemetry. I inject a power failure; the system detects low-battery and abnormal-power anomalies, raises deduplicated alerts, and auto-opens an investigation. Six agents run in sequence — telemetry monitoring, anomaly detection, space-weather, orbit intelligence, root-cause analysis, and report generation. A deterministic weighted-scoring engine (no LLM) concludes a payload power subsystem malfunction at ~80% confidence and CRITICAL severity, showing exactly why, including that quiet space weather rules out interference. As Mission Director I approve, resolve, and generate a printable report. It's fully offline and every step is recorded."

### 5-minute explanation
Add: the architecture (modular monolith, Node/TS backend, React frontend, SQLite), the anomaly rules with persistence and alert dedup, the orchestrator's sequential reliability and fixture fallback, provenance on every external datum, the confidence/severity math, and human-in-the-loop safety.

### 10-minute explanation
Add a live run following EVALUATION_DEMO.md, open the code (an agent, the scoring engine, a route), show `npm test` (22 tests), and discuss limitations and future live-mode.

---

## Part D — Evaluator Q&A (50+)

**Architecture & design**
1. *What architecture is this?* A modular monolith: one backend, one frontend, one embedded DB, six agents, three adapters.
2. *Why a monolith not microservices?* Reliability and simplicity for an evaluation MVP; no orchestration overhead.
3. *Why sequential agents, not parallel?* Deterministic, easy to reason about, and each stage feeds the next.
4. *Is there an LLM?* No. Reasoning is a deterministic rule/scoring engine — explainable and reproducible.
5. *Why no WebSockets?* Polling (~2–3s) is simpler and sufficient for this demo.
6. *Why Node instead of the specified Python/FastAPI?* Python isn't installed on the laptop and installing a runtime isn't permitted; Node is available, so the same architecture was built in Node/TypeScript to keep the demo runnable.
7. *How is it offline-first?* All external adapters default to OFFLINE_FIXTURE; no network, keys, or LLM needed.

**Agents & orchestration**
8. *How many agents and what are they?* Six: telemetry monitoring, anomaly detection, space weather, orbit intelligence, root-cause analysis, report generation.
9. *What does each agent output?* A typed object (see Part B); each also writes an AgentExecution record.
10. *Where are executions stored?* `agent_executions` table; shown as the Agent Execution Timeline.
11. *What if an agent fails?* It's recorded as FAILED with the message; the orchestrator continues where safe and never crashes the app.
12. *What is FALLBACK_USED status?* An agent used an adapter fixture fallback (e.g. live call failed).
13. *Who creates the investigation?* The simulator's monitoring loop, when anomalies persist and none is open.
14. *Can two investigations open for one incident?* No — an open investigation blocks duplicates (verified by test).

**Anomaly detection**
15. *What are the rules?* Temp>75, battery<25, signal<−110, power>850, altitude deviation>25 (all configurable).
16. *Why persistence?* To ignore single-sample noise; a rule must hold across N samples (default 3).
17. *How are alert storms prevented?* Dedup on active same-type alerts + a cooldown window.
18. *How is severity decided?* From how far past the threshold the value is, mapped to LOW/MEDIUM/HIGH/CRITICAL.

**Root cause & scoring**
19. *How is the root cause chosen?* Weighted evidence scores are normalized; the highest-scoring cause wins.
20. *Give an example weight.* ABNORMAL_POWER_CONSUMPTION → +0.45 PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION.
21. *How does space weather affect it?* Quiet weather penalizes SPACE_WEATHER_INTERFERENCE; a storm boosts it.
22. *How is confidence computed?* Deterministically from the winner's share + margin over runner-up, clamped 50–97%.
23. *Is it reproducible?* Yes — identical evidence always yields identical output (unit-tested).
24. *Why show a scoring breakdown?* Explainability — the evaluator sees exactly which factors drove the conclusion.
25. *What are the possible root causes?* Payload power, battery degradation, thermal, comms, space-weather interference, orbital perturbation, unknown.
26. *What if no anomalies?* The engine returns UNKNOWN_ANOMALY at 50% with a "continue monitoring" recommendation.

**External data & provenance**
27. *Which external sources?* NOAA SWPC (space weather), CelesTrak (orbit/TLE), OpenAlex (references).
28. *Are these live?* No — offline fixtures by default; clearly labelled OFFLINE FIXTURE.
29. *What is provenance?* source_name, source_url, retrieved_at, mode, cached, fallback_used — attached to every external result.
30. *What is the cache for?* A TTL cache avoids repeated fixture/live reads within a short window.
31. *Is OpenAlex on the critical path?* No — it's used only during report generation.

**Database & persistence**
32. *What database?* SQLite via Node's built-in `node:sqlite` (no native compilation).
33. *Where is the file?* `backend/data/orion.db`, inside the project.
34. *How is it seeded?* On first start when empty: 5 satellites, historical telemetry, one resolved investigation, default thresholds.
35. *What tables exist?* satellites, telemetry, alerts, investigations, evidence, recommendations, agent_executions, reports, system_settings.
36. *Is data persisted across restarts?* Yes (verified by retrieving created investigations/reports via the API).

**API & backend**
37. *What API style?* REST under `/api`, JSON, correct status codes (200/201/400/404/409/422/500).
38. *How are errors handled?* Central error handler maps domain errors to codes; no stack traces leak to clients.
39. *How do you block invalid transitions?* Approve/reject require WAITING_FOR_REVIEW; resolve requires APPROVED/REJECTED (else 409).
40. *How does the server bind?* 127.0.0.1 only (loopback) — never exposed to the LAN.
41. *How do you rerun analysis?* `POST /api/investigations/:id/rerun-analysis` re-runs the pipeline.

**Frontend**
42. *What stack?* React + TypeScript + Vite + Tailwind + Recharts + React Router.
43. *How does it get data?* A typed `api` client over `fetch`, same-origin `/api` proxied by Vite to the backend.
44. *How often does it refresh?* Polling every 2–3s via a `usePolling` hook.
45. *What states are handled?* Loading, error (with retry), and empty states across pages.
46. *Is the dashboard hardcoded?* No — all values come from the backend/database.
47. *How are reports exported?* The Report Details page has a Print/Save-PDF button with a clean print stylesheet.

**Safety & security**
48. *Does it control real satellites?* No — simulation/decision-support only; stated in the UI and every report.
49. *Are recommendations executed?* No — advisory only; a human must approve.
50. *Any secrets or company info in the code?* No — no credentials, keys, internal URLs, or company data.
51. *Any admin/system changes required?* No — project-local installs only; loopback binding; no system modification.
52. *What happens with no internet?* Everything works — adapters use offline fixtures.

**Testing & limitations**
53. *What's tested?* 22 Vitest tests: anomaly rules, RCA determinism & confidence bounds, offline adapters, and the full end-to-end demo flow (auto-investigation → 6 agents → approve → resolve → report).
54. *Known limitations?* No auth, live mode disabled, deterministic (not ML) reasoning, single-user local demo.
55. *Future work?* Optional live adapter mode behind an explicit network toggle, analytics, RBAC, bundle code-splitting.

---

## Glossary
**Telemetry** measurements from a spacecraft · **Anomaly** an out-of-range condition · **Agent** a focused task-performing program · **Orchestrator** coordinates agents · **RCA** Root Cause Analysis · **Provenance** where data came from · **Kp index** a geomagnetic activity measure · **TLE** Two-Line Element set describing an orbit · **Fixture** bundled offline sample data · **Deterministic** same input → same output.
