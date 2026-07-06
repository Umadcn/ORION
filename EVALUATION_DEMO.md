# PROJECT ORION — Evaluation Demo Guide

A precise, click-by-click script for demonstrating Project ORION. Everything runs **offline**.

---

## Pre-demo checklist

- [ ] Node.js ≥ 22.5 available (`node --version`).
- [ ] `backend/node_modules` and `frontend/node_modules` exist (run `npm install` in each if not).
- [ ] Two terminals ready.
- [ ] Browser ready at http://127.0.0.1:5173.

## Startup

**Terminal 1 (backend):**
```bash
cd backend
npm start
```
Wait for: `[ORION] Backend listening on http://127.0.0.1:8000 (mode=OFFLINE_FIXTURE)`

**Terminal 2 (frontend):**
```bash
cd frontend
npm run dev
```
Wait for: `Local: http://127.0.0.1:5173/`

Open **http://127.0.0.1:5173**.

## Reset procedure (do this before every run)

Go to **Simulation** → click **Reset Demo**. This returns to a clean, evaluation-ready state (5 healthy satellites, no active alerts/investigations). It never deletes the database; historical resolved investigations and reports are preserved.

---

## Click-by-click demonstration

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Open **Dashboard** | 5 satellites, all HEALTHY; KPI cards; Kp index (QUIET, offline fixture) |
| 2 | Go to **Simulation** | Status STOPPED, no active failures |
| 3 | Click **Reset Demo** | Toast "Reset Demo ✓"; satellites healthy |
| 4 | Click **Start Simulation** | Status RUNNING · tick counter climbs; live telemetry chart animates |
| 5 | Select satellite **ORION-3** | dropdown = ORION-3 |
| 6 | Select failure **POWER_SYSTEM_FAILURE** | description updates |
| 7 | Click **Inject Failure** | Toast "Inject Power System Failure ✓"; ORION-3 appears under Active Failures |
| 8 | Watch **Live Telemetry — ORION-3** (~15–20s) | Battery line falls; Power line climbs above 850W |
| 9 | Watch **Simulation Event Log** | "Alert raised: ABNORMAL_POWER_CONSUMPTION", "LOW_BATTERY", "Investigation #N auto-created", "analysis complete → PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION" |
| 10 | Go to **Alerts** | ACTIVE alerts for ORION-3 (LOW_BATTERY, ABNORMAL_POWER_CONSUMPTION), linked to INV# |
| 11 | Go to **Investigations** | The ORION-3 investigation, status WAITING_FOR_REVIEW, ~80%, CRITICAL |
| 12 | Open the investigation | Full details (below) |
| 13 | Review **Agent Execution Timeline** | 5 agents COMPLETED (telemetry, anomaly, space-weather, orbit, RCA) |
| 14 | Review **Root Cause** | PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION, confidence ~80%, severity CRITICAL |
| 15 | Review **Evidence** | telemetry + anomaly evidence; space-weather & orbit each tagged **OFFLINE FIXTURE** |
| 16 | Review **Scoring Breakdown** | Payload power highest; contributions shown; quiet space weather listed as contradicting |
| 17 | Review **Recommended Actions** | Disable non-essential payloads, enable power-saving mode, inspect payload subsystem, continue monitoring |
| 18 | Click **Approve** → **Approve** in modal | Status → APPROVED; timeline advances |
| 19 | Click **Resolve Investigation** | Status → RESOLVED |
| 20 | Click **Generate Report** | Report Generation Agent runs (6th agent); redirect available |
| 21 | Open report / go to **Reports** | Structured report with references + provenance |
| 22 | Click **Print / Save PDF** | Browser print dialog (clean printable layout) |
| 23 | (Optional) **Settings** | Edit thresholds, save/reset; integration status shows OFFLINE FIXTURE MODE |

### Expected RCA output (ORION-3 POWER_SYSTEM_FAILURE)
- **Root cause:** `PAYLOAD_POWER_SUBSYSTEM_MALFUNCTION`
- **Confidence:** ~80% (deterministic; bounded 50–97%)
- **Severity:** HIGH → CRITICAL
- **Anomalies:** `LOW_BATTERY`, `ABNORMAL_POWER_CONSUMPTION`
- **Space weather:** QUIET (Kp 2.3) → listed as *contradicting* (does not explain the incident)
- **Orbit:** nominal → no relevant deviation

---

## Fallback plan if a runtime issue occurs

- **Frontend can't reach backend:** confirm Terminal 1 shows the listening line; visit http://127.0.0.1:8000/api/health. Restart `npm start`.
- **Investigation didn't appear:** give it ~20s; the simulator needs several ticks for anomalies to persist. Check the Simulation Event Log. You can also open an existing resolved investigation to show the completed flow.
- **Backend won't start / port busy:** change the port — `ORION_PORT=8010 npm start` (and set the Vite proxy target accordingly), or stop the other process on 8000.
- **Everything else fails:** run `cd backend && npm test` to demonstrate the full pipeline (22 passing tests including the end-to-end investigation flow).

## 30-second backup explanation
"ORION simulates 5 satellites. I inject a power failure on ORION-3. The system detects low-battery and abnormal-power anomalies, opens an investigation, and runs six agents — telemetry, anomaly, space-weather, orbit, root-cause, and report. A deterministic scoring engine concludes a payload power subsystem malfunction at ~80% confidence, with quiet space weather ruled out. I approve as Mission Director, resolve, and generate a printable report. All offline, no LLM, fully explainable."

## 2-minute explanation
Cover: (1) the problem — telemetry overload during anomalies; (2) the pipeline — simulate → detect → alert → investigate → 6 agents → RCA → human review → report; (3) why deterministic scoring (explainable, auditable, reproducible) rather than an LLM; (4) offline adapters with provenance so the demo works with no internet; (5) human-in-the-loop safety — recommendations are advisory, nothing commands a real satellite.

## Common evaluator questions
See **PROJECT_NOTES.md** section "Evaluator Q&A" for 50+ questions and answers.
