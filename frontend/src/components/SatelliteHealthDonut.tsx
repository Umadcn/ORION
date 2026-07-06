import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Satellite } from '../types';

/** Donut of satellite health buckets, derived from real satellite status. */
export function SatelliteHealthDonut({ satellites }: { satellites: Satellite[] }) {
  const navigate = useNavigate();
  const healthy = satellites.filter((s) => s.status === 'HEALTHY').length;
  const warning = satellites.filter((s) => s.status === 'WARNING').length;
  const critical = satellites.filter((s) => s.status === 'ALERT' || s.status === 'OFFLINE').length;
  const total = satellites.length;

  const data = [
    { name: 'Healthy', value: healthy, color: '#22c55e' },
    { name: 'Warning', value: warning, color: '#f59e0b' },
    { name: 'Critical', value: critical, color: '#ef4444' },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-36 w-36 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.length ? data : [{ name: 'None', value: 1, color: '#273349' }]} dataKey="value" innerRadius={46} outerRadius={64} paddingAngle={2} startAngle={90} endAngle={-270} stroke="none">
              {(data.length ? data : [{ color: '#273349' }]).map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#0d1220', border: '1px solid #273349', borderRadius: 8, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white">{total}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Satellites</span>
        </div>
      </div>
      <ul className="flex-1 space-y-2">
        {[
          { label: 'Healthy', value: healthy, color: '#22c55e', status: 'HEALTHY' },
          { label: 'Warning', value: warning, color: '#f59e0b', status: 'WARNING' },
          { label: 'Critical', value: critical, color: '#ef4444', status: 'ALERT' },
        ].map((row) => (
          <li key={row.label}>
            <button onClick={() => navigate('/satellites')} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 hover:bg-space-800">
              <span className="flex items-center gap-2 text-sm text-slate-300"><span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} /> {row.label}</span>
              <span className="font-mono text-sm text-slate-200">{row.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
