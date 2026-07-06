import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import type { Telemetry } from '../types';
import { EmptyState } from './ui';

const SERIES = [
  { key: 'battery_percent', name: 'Battery (%)', color: '#22c55e' },
  { key: 'temperature_c', name: 'Temp (°C)', color: '#ef4444' },
  { key: 'power_consumption_w', name: 'Power (W)', color: '#f59e0b' },
  { key: 'signal_strength_dbm', name: 'Signal (dBm)', color: '#3b82f6' },
] as const;

export function TelemetryChart({
  data,
  height = 300,
  series = SERIES.map((s) => s.key),
}: {
  data: Telemetry[];
  height?: number;
  series?: string[];
}) {
  if (!data || data.length === 0) return <EmptyState message="No telemetry samples yet. Start the simulation." />;

  const rows = data.map((t) => ({
    t: new Date(t.timestamp).toISOString().slice(11, 19),
    battery_percent: t.battery_percent,
    temperature_c: t.temperature_c,
    power_consumption_w: t.power_consumption_w,
    signal_strength_dbm: t.signal_strength_dbm,
    altitude_km: t.altitude_km,
  }));

  const active = SERIES.filter((s) => series.includes(s.key));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="#1b2436" vertical={false} />
        <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 11 }} stroke="#273349" minTickGap={40} />
        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} stroke="#273349" />
        <Tooltip
          contentStyle={{ background: '#0d1220', border: '1px solid #273349', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {active.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SingleMetricChart({
  data,
  metric,
  name,
  color,
  height = 180,
}: {
  data: Telemetry[];
  metric: keyof Telemetry;
  name: string;
  color: string;
  height?: number;
}) {
  if (!data || data.length === 0) return <EmptyState message="No data" />;
  const rows = data.map((t) => ({ t: new Date(t.timestamp).toISOString().slice(11, 19), v: t[metric] as number }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="#1b2436" vertical={false} />
        <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 10 }} stroke="#273349" minTickGap={40} />
        <YAxis tick={{ fill: '#64748b', fontSize: 10 }} stroke="#273349" width={44} />
        <Tooltip
          contentStyle={{ background: '#0d1220', border: '1px solid #273349', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Line type="monotone" dataKey="v" name={name} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
