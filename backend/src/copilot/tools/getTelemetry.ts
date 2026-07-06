/** Read-only tool: recent bounded telemetry window for a satellite. */
import { getRecentTelemetry } from '../../services/telemetryService.js';
import type { ToolDefinition } from '../types.js';

export const getTelemetryTool: ToolDefinition = {
  name: 'getTelemetry',
  description: 'Get the most recent bounded telemetry samples for a satellite.',
  version: 'v1',
  readOnly: true,
  timeoutMs: 2000,
  maxOutputChars: 4000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['satelliteId'],
    properties: { satelliteId: { type: 'string' }, limit: { type: 'integer' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
    required: ['satelliteId', 'samples'],
    properties: { satelliteId: { type: 'string' }, samples: { type: 'array', items: { type: 'object' } } },
  },
  execute(args) {
    const id = String(args.satelliteId ?? '').toUpperCase();
    const limit = Math.max(1, Math.min(Math.floor(Number(args.limit) || 5), 20));
    const rows = getRecentTelemetry(id, limit);
    const latest = rows[rows.length - 1];
    return {
      satelliteId: id,
      count: rows.length,
      latest: latest
        ? {
            timestamp: latest.timestamp,
            temperature_c: latest.temperature_c,
            battery_percent: latest.battery_percent,
            signal_strength_dbm: latest.signal_strength_dbm,
            power_consumption_w: latest.power_consumption_w,
          }
        : null,
      samples: rows.map((r) => ({
        timestamp: r.timestamp,
        temperature_c: r.temperature_c,
        battery_percent: r.battery_percent,
        signal_strength_dbm: r.signal_strength_dbm,
        power_consumption_w: r.power_consumption_w,
      })),
    };
  },
};
