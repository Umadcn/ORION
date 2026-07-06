import type { AgentStatus, InvestigationStatus, Severity } from '../types';

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clockUTC(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toISOString().slice(11, 19);
}

export function dateUTC(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toISOString().slice(0, 10);
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n * 100)}%`;
}

export function humanize(token: string | null | undefined): string {
  if (!token) return '—';
  return token
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Single canonical role → display-label mapping. Normalizes any backend role
 * format (MISSION_ANALYST, mission_analyst, "Mission Analyst",
 * ROLE_MISSION_ANALYST) through one function — never duplicate role formatting
 * in components. Returns '' for a missing role (neutral, never a default identity).
 */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  const key = role.trim().toUpperCase().replace(/^ROLE_/, '').replace(/[\s-]+/g, '_');
  const map: Record<string, string> = {
    MISSION_DIRECTOR: 'Mission Director',
    MISSION_ANALYST: 'Mission Analyst',
    MISSION_OPERATOR: 'Mission Operator',
    SYSTEM_ADMIN: 'System Administrator',
    ADMIN: 'Administrator',
    AUDITOR: 'Auditor',
  };
  return map[key] ?? humanize(key);
}

/**
 * The name shown in the Dashboard welcome banner, derived ONLY from the
 * authenticated session: the user's real display name if present, else the
 * normalized role label. Returns '' when there is no user (no hardcoded default).
 */
export function welcomeName(user: { display_name?: string | null; role?: string | null } | null | undefined): string {
  if (!user) return '';
  const name = user.display_name?.trim();
  return name || roleLabel(user.role);
}

/** Up-to-two-letter initials from a name/username; '' when neither exists. */
export function userInitials(source: string | null | undefined): string {
  const s = (source ?? '').trim();
  if (!s) return '';
  return s.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// ---- Color helpers (tailwind class strings) ----

export function severityClasses(sev: Severity | string | null | undefined): { text: string; bg: string; border: string } {
  switch (sev) {
    case 'CRITICAL':
      return { text: 'text-accent-red', bg: 'bg-accent-red/15', border: 'border-accent-red/40' };
    case 'HIGH':
      return { text: 'text-accent-orange', bg: 'bg-accent-orange/15', border: 'border-accent-orange/40' };
    case 'MEDIUM':
      return { text: 'text-yellow-300', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30' };
    default:
      return { text: 'text-slate-300', bg: 'bg-slate-400/10', border: 'border-slate-500/30' };
  }
}

export function statusColor(status: SatelliteLike): string {
  switch (status) {
    case 'HEALTHY':
      return 'text-accent-green';
    case 'WARNING':
      return 'text-accent-orange';
    case 'ALERT':
    case 'OFFLINE':
      return 'text-accent-red';
    default:
      return 'text-slate-300';
  }
}
type SatelliteLike = 'HEALTHY' | 'WARNING' | 'ALERT' | 'OFFLINE' | string;

export function healthBarColor(health: number): string {
  if (health >= 80) return 'bg-accent-green';
  if (health >= 55) return 'bg-accent-orange';
  return 'bg-accent-red';
}

export function investigationStatusClasses(status: InvestigationStatus | string): { text: string; bg: string } {
  switch (status) {
    case 'RESOLVED':
      return { text: 'text-accent-green', bg: 'bg-accent-green/15' };
    case 'APPROVED':
      return { text: 'text-accent-cyan', bg: 'bg-accent-cyan/15' };
    case 'REJECTED':
      return { text: 'text-slate-400', bg: 'bg-slate-500/15' };
    case 'WAITING_FOR_REVIEW':
      return { text: 'text-accent-purple', bg: 'bg-accent-purple/15' };
    case 'ANALYZING':
      return { text: 'text-accent-blue', bg: 'bg-accent-blue/15' };
    default:
      return { text: 'text-accent-orange', bg: 'bg-accent-orange/15' };
  }
}

export function agentStatusColor(status: AgentStatus | string): string {
  switch (status) {
    case 'COMPLETED':
      return 'text-accent-green';
    case 'FALLBACK_USED':
      return 'text-accent-orange';
    case 'FAILED':
      return 'text-accent-red';
    case 'RUNNING':
      return 'text-accent-blue';
    default:
      return 'text-slate-400';
  }
}

/** Mission Copilot execution-mode/status badge label + tailwind classes. */
export function copilotModeBadge(status: string): { label: string; text: string; bg: string } {
  switch (status) {
    case 'REAL_PROVIDER':
      return { label: 'AI Model', text: 'text-accent-green', bg: 'bg-accent-green/15' };
    case 'DETERMINISTIC_FALLBACK':
      return { label: 'Deterministic', text: 'text-accent-cyan', bg: 'bg-accent-cyan/15' };
    case 'INSUFFICIENT_EVIDENCE':
      return { label: 'Insufficient Evidence', text: 'text-accent-orange', bg: 'bg-accent-orange/15' };
    case 'FAILED':
      return { label: 'Failed', text: 'text-accent-red', bg: 'bg-accent-red/15' };
    default:
      return { label: humanize(status), text: 'text-slate-300', bg: 'bg-slate-500/15' };
  }
}

export const INVESTIGATION_STAGES: InvestigationStatus[] = [
  'DETECTED',
  'ANALYZING',
  'WAITING_FOR_REVIEW',
  'APPROVED',
  'RESOLVED',
];
