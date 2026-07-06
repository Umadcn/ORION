/**
 * Seeded offline mission corpus (Phase 2).
 *
 * These are ORIGINAL, synthetic ORION documents — they do NOT reproduce any
 * copyrighted manual or external article. They exist to exercise chunking and
 * vector retrieval fully offline. All content is provenance-labeled
 * SYNTHETIC_ORION_CORPUS.
 *
 * Seeding is deterministic and idempotent: it runs only when no knowledge
 * documents exist, uses canonical stable IDs, and embeds with the offline
 * LocalHashEmbedding provider so startup requires no network. The seed path is
 * synchronous to fit the existing initOrion() convention.
 */
import { config } from '../config.js';
import { chunkDocument } from './chunk.js';
import { normalizeStableDocumentId } from './citations.js';
import { normalizeAndHash } from './normalize.js';
import { LocalHashEmbedding } from '../embeddings/localHashEmbedding.js';
import { documentRepo } from './repository.js';
import { vectorStore } from './vectorStore.js';
import type { KnowledgeChunkMetadata, KnowledgeClassification, KnowledgeDocumentInput } from './types.js';

const PROVENANCE = 'SYNTHETIC_ORION_CORPUS';

type SeedDoc = Required<
  Pick<KnowledgeDocumentInput, 'stableDocumentId' | 'title' | 'sourceType' | 'content' | 'documentVersion'>
> &
  Pick<KnowledgeDocumentInput, 'subsystem' | 'satelliteId' | 'anomalyType' | 'classification'>;

export const SEED_CORPUS: SeedDoc[] = [
  {
    stableDocumentId: 'ORION-POWER-OPS-MANUAL',
    title: 'ORION Power Subsystem Operations Manual',
    sourceType: 'MISSION_MANUAL',
    subsystem: 'POWER',
    anomalyType: 'POWER_DEGRADATION',
    classification: 'INTERNAL',
    documentVersion: 'v3',
    content: `ORION POWER SUBSYSTEM OPERATIONS MANUAL

1. OVERVIEW
The ORION electrical power subsystem (EPS) comprises triple-junction solar arrays, a lithium-ion battery module, a power conditioning and distribution unit (PCDU), and redundant load switches. Nominal bus voltage is 28.0 volts. The battery module holds eight series cells with a rated depth of discharge of 30 percent per orbit. Operators must keep battery state of charge above 55 percent during eclipse.

2. NOMINAL OPERATIONS
During sunlit phases the arrays generate between 600 and 720 watts depending on beta angle. The PCDU regulates the main bus and charges the battery at a controlled rate not exceeding 2.4 amperes. Power consumption above 680 watts for more than three consecutive telemetry frames is considered elevated and should be investigated by the Power Analysis procedure.

3. DEGRADATION SIGNATURES
Gradual reduction in array output is expected at approximately 2 percent per year due to radiation. A sudden drop of more than 40 watts between adjacent frames, combined with rising cell temperature, indicates a possible string fault or micrometeoroid impact. Battery percent falling below 70 percent under nominal load points to a charging fault in the PCDU rather than a natural discharge.

4. RESPONSE ACTIONS
When elevated power consumption coincides with a battery percent decline, operators should first confirm array orientation, then shed non-critical payload loads, and finally transition the affected satellite toward a reduced-power posture. These actions are advisory and require Mission Director approval before any command is prepared. ORION never commands a live spacecraft; all actions are decision-support simulations.`,
  },
  {
    stableDocumentId: 'ORION-THERMAL-TROUBLESHOOTING',
    title: 'ORION Thermal Control Troubleshooting Guide',
    sourceType: 'TROUBLESHOOTING_GUIDE',
    subsystem: 'THERMAL',
    anomalyType: 'THERMAL_EXCURSION',
    classification: 'INTERNAL',
    documentVersion: 'v2',
    content: `ORION THERMAL CONTROL TROUBLESHOOTING GUIDE

PURPOSE
This guide helps analysts diagnose thermal excursions on ORION spacecraft. The thermal control subsystem uses passive radiators, multilayer insulation, and electric survival heaters governed by a thermostat table.

NORMAL RANGES
Bus component temperatures are maintained between 15 and 30 degrees Celsius. Battery temperature is held between 5 and 25 degrees Celsius. Payload sensor temperature is mission specific but typically below 35 degrees Celsius.

SYMPTOM: RISING TEMPERATURE
A steady rise above 30 degrees Celsius that tracks with increased power consumption usually indicates a stuck-on heater or a failed thermostat. A rise that is independent of power and correlates with the sunlit portion of the orbit points to a degraded radiator coating or lost insulation.

SYMPTOM: FALLING TEMPERATURE
Temperatures drifting below the survival limit during eclipse indicate a heater that failed off or insufficient available power to run heaters. Cross-check the power subsystem for a concurrent battery percent decline.

DIAGNOSTIC STEPS
Step 1: Compare temperature trend against the eclipse timeline. Step 2: Correlate with power consumption. Step 3: Review the thermostat command history for anomalies. Step 4: If temperature exceeds 45 degrees Celsius, treat the situation as a high-severity thermal excursion and escalate for Mission Director review. All recommendations are advisory only.`,
  },
  {
    stableDocumentId: 'ORION-COMMS-ANOMALY-PROC',
    title: 'ORION Communications Anomaly Procedure',
    sourceType: 'ANOMALY_PROCEDURE',
    subsystem: 'COMMUNICATIONS',
    anomalyType: 'COMMUNICATION_LOSS',
    classification: 'INTERNAL',
    documentVersion: 'v4',
    content: `ORION COMMUNICATIONS ANOMALY PROCEDURE

SCOPE
This procedure governs the diagnosis of degraded or lost downlink on ORION spacecraft. The communications subsystem includes an S-band transponder, a redundant backup transponder, and two patch antennas.

SIGNAL BASELINES
Nominal received signal strength at the ground station is between minus 90 and minus 100 dBm. A value below minus 110 dBm is considered degraded. A complete loss of carrier for more than two contact windows is classified as communication loss.

PROBABLE CAUSES
Degraded signal strength commonly results from antenna pointing error, transponder power droop, or increased path loss during low elevation passes. A sudden total loss usually indicates a transponder fault or an attitude control problem that has mispointed the antenna.

RECOVERY SEQUENCE
First, verify the attitude solution and antenna pointing. Second, if the primary transponder shows power droop, prepare a recommendation to switch to the redundant backup transponder. Third, schedule an additional ground station contact to confirm recovery. Historical cases show that switching to the redundant transponder restored the downlink within one orbit. These steps are advisory; ORION does not transmit commands to real hardware.`,
  },
  {
    stableDocumentId: 'ORION-ADCS-MISSION-RULES',
    title: 'ORION Attitude Control Mission Rules',
    sourceType: 'MISSION_RULE',
    subsystem: 'ATTITUDE_CONTROL',
    anomalyType: 'ATTITUDE_ANOMALY',
    classification: 'RESTRICTED',
    documentVersion: 'v1',
    content: `ORION ATTITUDE CONTROL MISSION RULES

RULE ADCS-1
The attitude determination and control subsystem shall maintain pointing error below 0.5 degrees during science collection. If pointing error exceeds 2 degrees, the spacecraft simulation shall be flagged for an attitude anomaly review.

RULE ADCS-2
Reaction wheel speed shall remain below 5500 revolutions per minute. Wheel speeds approaching saturation require a momentum management review. Sustained saturation is a precursor to loss of pointing control.

RULE ADCS-3
If gyro rates exceed 1.0 degrees per second without a commanded slew, the situation shall be treated as a tumbling risk and escalated to high severity. Concurrent communication loss increases the likelihood that antenna mispointing is caused by an attitude fault.

RULE ADCS-4
Safe mode entry is the standard protective response to an uncontrolled attitude excursion. Safe mode points the arrays at the sun and suspends payload operations. Any transition recommendation requires explicit human approval and is advisory within the ORION decision-support simulation.`,
  },
  {
    stableDocumentId: 'ORION-3-PAYLOAD-POWER-INCIDENT',
    title: 'ORION-3 Historical Payload Power Incident',
    sourceType: 'INCIDENT_REPORT',
    subsystem: 'POWER',
    satelliteId: 'ORION-3',
    anomalyType: 'PAYLOAD_POWER_MALFUNCTION',
    classification: 'INTERNAL',
    documentVersion: 'v1',
    content: `ORION-3 HISTORICAL PAYLOAD POWER INCIDENT REPORT

SUMMARY
On a prior mission phase, ORION-3 experienced a payload power malfunction characterized by elevated power consumption above 690 watts accompanied by a battery percent decline from 97 percent to 74 percent over six telemetry frames. The scientific payload was the dominant load at the time.

TIMELINE
Frame 1 through 3 showed nominal behavior. At frame 4 power consumption rose sharply while bus voltage sagged. At frame 5 battery percent began declining faster than the modeled eclipse discharge. At frame 6 the payload controller reported an over-current flag.

ROOT CAUSE
Analysis attributed the event to a latch-up in the payload power converter that drew excess current until the protective load switch isolated the payload. This was classified as a payload power subsystem malfunction rather than a natural battery discharge.

RESOLUTION AND LESSONS
Isolating the payload load restored nominal power margins. The incident reinforced that a simultaneous rise in power consumption and fall in battery percent is a strong signature of a payload power fault. Operators should correlate these two channels before concluding a generic battery degradation.`,
  },
  {
    stableDocumentId: 'ORION-BATTERY-DEGRADATION-REPORT',
    title: 'ORION Battery Degradation Incident Report',
    sourceType: 'INCIDENT_REPORT',
    subsystem: 'POWER',
    anomalyType: 'BATTERY_DEGRADATION',
    classification: 'INTERNAL',
    documentVersion: 'v2',
    content: `ORION BATTERY DEGRADATION INCIDENT REPORT

SUMMARY
This report documents a gradual battery degradation trend observed across multiple orbits. Unlike the ORION-3 payload power event, this case showed a slow decline in end-of-charge voltage without elevated power consumption.

OBSERVATIONS
End-of-charge voltage decreased by roughly 0.15 volts over thirty orbits. Depth of discharge crept upward as usable capacity fell. Battery temperature remained within the nominal 5 to 25 degrees Celsius band, ruling out a thermal cause.

ANALYSIS
The signature is consistent with normal lithium-ion aging accelerated by frequent deep discharge cycles. Because power consumption stayed nominal, the analysts concluded that the root cause was cell aging rather than a converter latch-up or charging fault.

RECOMMENDATIONS
Reduce depth of discharge by shedding non-critical loads during eclipse, and update the battery capacity model. Battery aging is distinct from an acute payload power malfunction and should not be scored as a subsystem fault. All guidance is advisory.`,
  },
  {
    stableDocumentId: 'ORION-SAFE-MODE-RECOVERY',
    title: 'ORION Safe Mode Recovery Procedure',
    sourceType: 'ANOMALY_PROCEDURE',
    subsystem: 'FLIGHT_SOFTWARE',
    anomalyType: 'SAFE_MODE',
    classification: 'INTERNAL',
    documentVersion: 'v3',
    content: `ORION SAFE MODE RECOVERY PROCEDURE

DEFINITION
Safe mode is an autonomous protective state entered when the flight software detects an unrecoverable fault, a power emergency, or an uncontrolled attitude excursion. In safe mode the spacecraft sun-points its arrays, disables the payload, and simplifies attitude control.

ENTRY TRIGGERS
Typical triggers include battery percent falling below the critical threshold, reaction wheel saturation with rising pointing error, and repeated flight computer resets. Each trigger is recorded in the fault log for later review.

RECOVERY STEPS
Step 1: Confirm the trigger from the fault log. Step 2: Verify power margins are positive and battery percent is recovering. Step 3: Restore attitude control and confirm pointing error below 0.5 degrees. Step 4: Re-enable the payload only after power and thermal margins are confirmed. Step 5: Prepare an advisory recovery recommendation for Mission Director approval.

CAUTION
Recovery from safe mode is deliberate and staged. Rushing payload re-activation risks re-entry into safe mode. Within ORION these steps are simulated decision support and never command a live spacecraft.`,
  },
  {
    stableDocumentId: 'ORION-GROUND-LINK-TROUBLESHOOTING',
    title: 'ORION Ground Station Link Troubleshooting Guide',
    sourceType: 'TROUBLESHOOTING_GUIDE',
    subsystem: 'GROUND_SEGMENT',
    anomalyType: 'COMMUNICATION_LOSS',
    classification: 'INTERNAL',
    documentVersion: 'v1',
    content: `ORION GROUND STATION LINK TROUBLESHOOTING GUIDE

PURPOSE
This guide addresses link problems that originate in the ground segment rather than on the spacecraft. It complements the Communications Anomaly Procedure by ruling out ground causes first.

GROUND SEGMENT CHECKS
Verify the ground station antenna is tracking the predicted pass. Confirm the receiver is locked to the correct S-band frequency and that the demodulator reports symbol lock. Check that the scheduling system assigned a valid contact window and that no maintenance outage overlaps the pass.

DISTINGUISHING GROUND FROM SPACE
If multiple satellites show degraded reception at the same station, the fault is almost certainly in the ground segment. If only one satellite is affected while others are nominal at the same station, suspect the spacecraft transponder or antenna pointing.

RESOLUTION
For ground faults, fail over to an alternate ground station and re-run the contact. Update the pass schedule and confirm symbol lock. If the problem persists across stations for a single satellite, escalate to the Communications Anomaly Procedure. All recommendations are advisory and offline.`,
  },
];

/** Seed the synthetic corpus if no knowledge documents exist yet. Idempotent. */
export function seedKnowledgeIfEmpty(): void {
  if (documentRepo.list({ limit: 1 }).total > 0) return;

  const embedder = new LocalHashEmbedding(config.embedding.dimension);
  const chunkCfg = {
    chunkSize: config.knowledge.chunkSize,
    chunkOverlap: config.knowledge.chunkOverlap,
    minChunkSize: Math.min(200, Math.floor(config.knowledge.chunkSize / 4)),
  };

  for (const seed of SEED_CORPUS) {
    const stableId = normalizeStableDocumentId(seed.stableDocumentId);
    const { normalized, hash } = normalizeAndHash(seed.content);
    const classification: KnowledgeClassification = seed.classification ?? 'UNCLASSIFIED';

    const doc = documentRepo.create({
      stable_document_id: stableId,
      title: seed.title,
      source_type: seed.sourceType,
      classification,
      subsystem: seed.subsystem ?? null,
      satellite_id: seed.satelliteId ?? null,
      anomaly_type: seed.anomalyType ?? null,
      document_version: seed.documentVersion,
      source_uri: null,
      provenance_origin: PROVENANCE,
      content_hash: hash,
      normalized_content: normalized,
      char_count: normalized.length,
      status: 'PROCESSING',
      created_by: 'system-seed',
    });

    const chunks = chunkDocument(stableId, normalized, chunkCfg);
    const vectors = embedder.embedBatchSync(chunks.map((c) => c.content));
    const metadata: KnowledgeChunkMetadata = {
      documentId: doc.id,
      stableDocumentId: stableId,
      title: seed.title,
      sourceType: seed.sourceType,
      classification,
      subsystem: seed.subsystem ?? null,
      satelliteId: seed.satelliteId ?? null,
      anomalyType: seed.anomalyType ?? null,
      documentVersion: seed.documentVersion,
    };

    vectorStore.upsertChunks(doc.id, chunks, vectors, {
      provider: embedder.name,
      model: embedder.model,
      mode: embedder.mode,
      version: embedder.version,
      dimension: embedder.dimension(),
    }, JSON.stringify(metadata));

    documentRepo.setChunkCount(doc.id, chunks.length);
    documentRepo.updateStatus(doc.id, 'READY');
  }
}
