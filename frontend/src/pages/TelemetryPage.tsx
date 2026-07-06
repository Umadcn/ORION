import { useState } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { ErrorState, LoadingState, Panel } from '../components/ui';
import { SingleMetricChart } from '../components/TelemetryChart';

export default function TelemetryPage() {
  const sats = usePolling(() => api.satellites(), 8000);
  const [sat, setSat] = useState('ORION-3');
  const [limit, setLimit] = useState(60);
  const telemetry = usePolling(() => api.satelliteTelemetry(sat, limit), 3000, [sat, limit]);

  const data = telemetry.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Telemetry</h1>
          <p className="text-sm text-slate-400">Live metric streams (polling every 3s)</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={sat} onChange={(e) => setSat(e.target.value)} className="rounded-lg border border-space-600 bg-space-800 px-3 py-2 text-sm text-slate-200">
            {(sats.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="rounded-lg border border-space-600 bg-space-800 px-3 py-2 text-sm text-slate-200">
            <option value={30}>Last 30</option>
            <option value={60}>Last 60</option>
            <option value={120}>Last 120</option>
          </select>
        </div>
      </div>

      {telemetry.loading ? <LoadingState /> : telemetry.error ? <ErrorState message={telemetry.error} onRetry={telemetry.refetch} /> : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Battery (%)"><SingleMetricChart data={data} metric="battery_percent" name="Battery" color="#22c55e" /></Panel>
          <Panel title="Temperature (°C)"><SingleMetricChart data={data} metric="temperature_c" name="Temp" color="#ef4444" /></Panel>
          <Panel title="Power Consumption (W)"><SingleMetricChart data={data} metric="power_consumption_w" name="Power" color="#f59e0b" /></Panel>
          <Panel title="Signal Strength (dBm)"><SingleMetricChart data={data} metric="signal_strength_dbm" name="Signal" color="#3b82f6" /></Panel>
          <Panel title="Altitude (km)"><SingleMetricChart data={data} metric="altitude_km" name="Altitude" color="#22d3ee" /></Panel>
          <Panel title="Velocity (km/s)"><SingleMetricChart data={data} metric="velocity_kms" name="Velocity" color="#a855f7" /></Panel>
        </div>
      )}
    </div>
  );
}
