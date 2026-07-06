/** Read-only tool: fetch a satellite's current deterministic state. */
import { getSatellite as getSat } from '../../services/telemetryService.js';
import { resolveSatelliteStatus } from '../../services/satelliteStatus.js';
import type { ToolDefinition } from '../types.js';

export const getSatelliteTool: ToolDefinition = {
  name: 'getSatellite',
  description: 'Get a satellite\'s current deterministic state (health, status, mission, orbit).',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 2000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['satelliteId'],
    properties: { satelliteId: { type: 'string' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['found'],
    properties: { found: { type: 'boolean' } },
  },
  execute(args) {
    const id = String(args.satelliteId ?? '').toUpperCase();
    const sat = getSat(id);
    if (!sat) return { found: false, satelliteId: id };
    const r = resolveSatelliteStatus(sat);
    return {
      found: true,
      id: sat.id,
      name: sat.name,
      mission: sat.mission,
      orbit_type: sat.orbit_type,
      // `status` is the EFFECTIVE (manual-aware) status; derived + mode exposed for honest wording.
      status: r.effectiveStatus,
      status_mode: r.statusMode,
      manual_status: r.manualStatus,
      derived_status: r.derivedStatus,
      effective_status: r.effectiveStatus,
      manual_status_reason: r.manualStatusReason,
      health_score: sat.health_score,
      altitude_km: sat.altitude,
    };
  },
};
