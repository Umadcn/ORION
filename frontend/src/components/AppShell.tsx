import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity, AlertTriangle, Bot, Brain, FileText, LayoutDashboard, Menu, Orbit, Play, Radio,
  Satellite, Search, Settings, ShieldCheck, Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import { clockUTC, dateUTC } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { canAccess } from '../auth/permissions';
import { GlobalSearch } from './GlobalSearch';
import { ActivityIndicator, NotificationBell, ProfileMenu, SystemDiagnostics } from './HeaderWidgets';
import { SidebarAssistantCard } from './SidebarAssistantCard';
import { AiDrawer } from './AiDrawer';

const NAV_GROUPS: { label: string; items: { to: string; label: string; icon: typeof Orbit; end?: boolean }[] }[] = [
  {
    label: 'Mission Control',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/satellites', label: 'Satellites', icon: Satellite },
      { to: '/orbit', label: 'Orbit & Trajectory', icon: Orbit },
      { to: '/telemetry', label: 'Telemetry', icon: Activity },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/alerts', label: 'Alerts', icon: AlertTriangle },
      { to: '/ai-assistant', label: 'AI Assistant', icon: Bot },
      { to: '/ai-insights', label: 'AI Insights', icon: Sparkles },
      { to: '/ai-evaluation', label: 'AI Evaluation', icon: Brain },
      { to: '/investigations', label: 'Investigations', icon: Search },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/simulation', label: 'Simulation', icon: Play },
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<{ operational: boolean; alerts: number } | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [clock, setClock] = useState<string>(clockUTC());
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setClock(clockUTC()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.dashboardSummary();
        if (alive) setHealth({ operational: s.system_health === 'OPERATIONAL', alerts: s.active_alerts });
      } catch { if (alive) setHealth(null); }
    };
    void load();
    const t = setInterval(load, 4000);
    api.health().then((h) => alive && setMode(h.integration_mode)).catch(() => {});
    return () => { alive = false; clearInterval(t); };
  }, []);

  const sidebarWidth = collapsed ? 'lg:w-[68px]' : 'lg:w-64';

  return (
    <div className="flex h-dvh overflow-hidden bg-space-950">
      {/* Mobile overlay */}
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-shrink-0 flex-col border-r border-space-700 bg-space-900 transition-all duration-200 lg:static ${sidebarWidth} ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo — fixed height matches the top header so the dividers align */}
        <div className={`flex h-[var(--app-header-height)] flex-shrink-0 items-center gap-2.5 border-b border-space-700 px-4 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent-blue/30 to-accent-cyan/20 text-accent-blue">
            <Orbit className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-base font-bold leading-none tracking-wide text-white">ORION</div>
              <div className="mt-1 truncate text-[9px] uppercase tracking-[0.18em] text-slate-500">Space Mission Intelligence</div>
            </div>
          )}
        </div>

        {/* Nav (filtered by the authenticated user's role) */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((i) => canAccess(user?.role, i.to));
            if (items.length === 0) return null;
            return (
            <div key={group.label} className="mb-4">
              {!collapsed && <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">{group.label}</div>}
              <div className="space-y-1">
                {items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    title={collapsed ? label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${collapsed ? 'justify-center' : ''} ${
                        isActive
                          ? 'bg-gradient-to-r from-accent-orange/25 to-accent-orange/5 text-accent-orange shadow-[inset_2px_0_0_0_#f59e0b]'
                          : 'text-slate-400 hover:bg-space-800 hover:text-slate-200'
                      }`
                    }
                  >
                    <Icon className="h-[18px] w-[18px] flex-shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          );
          })}
        </nav>

        {/* AI Assistant card — anchored at the bottom (flex layout, not absolute) */}
        <div className="flex-shrink-0 border-t border-space-700 p-3">
          <SidebarAssistantCard collapsed={collapsed} onOpen={() => setAiOpen(true)} />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-[var(--app-header-height)] flex-shrink-0 items-center gap-3 border-b border-space-700 bg-space-900/80 px-4 backdrop-blur">
          <button onClick={() => { setMobileOpen((o) => !o); setCollapsed((c) => (window.innerWidth >= 1024 ? !c : c)); }} className="hdr-icon-btn" title="Toggle sidebar" aria-label="Toggle sidebar">
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {mode && (
              <div className="hdr-badge hidden border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan md:inline-flex" title="External data adapters run offline; no live network calls">
                <Radio className="h-3.5 w-3.5 flex-shrink-0" />
                {mode === 'OFFLINE_FIXTURE' ? 'OFFLINE · FIXTURE' : mode}
              </div>
            )}
            <div className={`hdr-badge hidden lg:inline-flex ${
              health?.operational ? 'border-accent-green/30 bg-accent-green/10 text-accent-green' : 'border-accent-orange/30 bg-accent-orange/10 text-accent-orange'
            }`}>
              <ShieldCheck className="h-4 w-4 flex-shrink-0" />
              <span>{health ? (health.operational ? 'OPERATIONAL' : 'DEGRADED') : '—'}</span>
            </div>
            <ActivityIndicator />
            <NotificationBell />
            <ProfileMenu user={user} onDiagnostics={() => setDiagOpen(true)} onLogout={logout} />
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">{children}</main>

        <footer className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-space-700 px-6 py-2.5 text-[11px] text-slate-600">
          <span className="truncate">Project ORION · Simulation / Decision-Support Only</span>
          <span className="flex-shrink-0 font-mono text-slate-500">{clock} UTC · {dateUTC()}</span>
        </footer>
      </div>

      <AiDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
      <SystemDiagnostics open={diagOpen} onClose={() => setDiagOpen(false)} />
    </div>
  );
}
