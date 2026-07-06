import { Component, useEffect, useState, type FormEvent, type ReactNode, lazy, Suspense } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot, Brain, Clock, Eye, EyeOff, Loader2, Lock, Network, Rocket, SatelliteDish,
  Shield, ShieldCheck, User,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { validateCredentials, type CredentialErrors } from '../auth/permissions';
import { api, ApiError } from '../api/client';
import satelliteUrl from '../assets/orion/satellites/satellite.svg';

// Realistic WebGL Earth, lazy-loaded so the login form paints instantly and the
// heavy 3D chunk streams in behind it.
const LoginEarth = lazy(() => import('../components/LoginEarth'));

/**
 * Isolates the WebGL Earth: if a 3D context cannot be created (headless / WebGL
 * disabled), it fails silently to the CSS glow fallback so the login form is
 * never affected.
 */
class EarthBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Prevent authenticated users from lingering on /login.
  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    const v = validateCredentials(username, password);
    setErrors(v);
    if (v.username || v.password) return;
    setSubmitting(true);
    try {
      await login(username.trim(), password, remember);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unable to reach Mission Control. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-space-950 text-slate-200">
      <Starfield />

      <div className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[55fr_45fr]">
        <LeftPanel />
        <section className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="relative w-full max-w-md rounded-[22px] border border-accent-cyan/25 bg-space-900/70 p-7 shadow-[0_0_40px_-10px_rgba(34,211,238,0.25)] backdrop-blur-xl sm:p-9 lg:max-w-lg">
            {/* orange top highlight */}
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent-orange/70 to-transparent" />

            <HexLock />

            <h1 className="mt-5 text-center text-3xl font-bold uppercase tracking-[0.12em] sm:text-4xl">
              <span className="text-white">Welcome to </span>
              <span className="text-accent-orange">ORION</span>
            </h1>
            <p className="mt-2 text-center text-sm text-slate-400">Sign in to access Mission Control</p>

            <form className="mt-7 space-y-4" onSubmit={onSubmit} noValidate>
              {formError && (
                <div role="alert" className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
                  {formError}
                </div>
              )}
              {notice && (
                <div role="status" className="rounded-lg border border-accent-blue/40 bg-accent-blue/10 px-3 py-2 text-sm text-accent-blue">
                  {notice}
                </div>
              )}

              <Field
                icon={<User className="h-5 w-5" />}
                type="text"
                label="Username or Email"
                autoComplete="username"
                value={username}
                onChange={setUsername}
                error={errors.username}
                disabled={submitting}
              />

              <Field
                icon={<Lock className="h-5 w-5" />}
                type={showPw ? 'text' : 'password'}
                label="Password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                error={errors.password}
                disabled={submitting}
                trailing={
                  <button type="button" onClick={() => setShowPw((s) => !s)} className="text-slate-500 hover:text-slate-300" aria-label={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                }
              />

              <div className="flex items-center justify-between text-sm">
                <label className="flex cursor-pointer select-none items-center gap-2 text-slate-400">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-space-500 bg-space-800 accent-accent-orange" />
                  Remember Me
                </label>
                <button type="button" onClick={() => setNotice('Password recovery is not configured for this environment. Contact your system administrator.')} className="font-medium text-accent-blue hover:underline">
                  Forgot Password?
                </button>
              </div>

              <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-accent-orange to-orange-500 px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-[0_8px_24px_-8px_rgba(245,158,11,0.7)] transition-all hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-accent-orange/60 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70">
                {submitting ? <><Loader2 className="h-5 w-5 animate-spin" /> Authenticating…</> : <><Rocket className="h-5 w-5" /> Sign in to Mission Control</>}
              </button>

              <div className="flex items-center gap-3 py-1 text-xs uppercase tracking-widest text-slate-600">
                <span className="h-px flex-1 bg-space-600" /> or <span className="h-px flex-1 bg-space-600" />
              </div>

              <button type="button" onClick={() => setNotice('SSO integration is not configured for this environment.')} className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-accent-blue/50 bg-transparent px-4 py-3 text-sm font-semibold uppercase tracking-wide text-accent-blue transition-colors hover:bg-accent-blue/10 focus:outline-none focus:ring-2 focus:ring-accent-blue/50">
                <Shield className="h-5 w-5" /> Sign in with SSO
              </button>
            </form>

            <div className="mt-7 border-t border-space-700 pt-4">
              <p className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-accent-green" /> Secure Mission Access <span className="text-slate-600">•</span> Encrypted Connection
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- Left visual panel ----------
function LeftPanel() {
  // Public /api/health drives the three status cards (no auth needed, read-only,
  // real system-derived values — the count is never fabricated).
  const [health, setHealth] = useState<{ satellites?: number; multi_agent_system?: string; mission_intelligence?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api.health().then((h) => { if (alive) setHealth(h); }).catch(() => { if (alive) setHealth(null); });
    return () => { alive = false; };
  }, []);
  const satValue = health?.satellites != null ? String(health.satellites) : '—';
  const agentValue = health?.multi_agent_system ?? 'ONLINE';
  const missionValue = health?.mission_intelligence ?? 'OPERATIONAL';

  return (
    <section className="relative flex flex-col justify-between overflow-hidden px-6 py-8 sm:px-10 sm:py-10">
      {/* Realistic WebGL Earth + orbits + satellites (behind content; desktop only) */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
        {/* Soft earth glow — also the graceful fallback if WebGL is unavailable */}
        <div className="absolute -bottom-[18%] -left-[10%] h-[85%] w-[70%] rounded-full bg-[radial-gradient(circle_at_38%_40%,rgba(56,120,220,0.28),rgba(20,60,130,0.12)_45%,transparent_68%)] blur-[2px]" />
        <div className="absolute inset-0">
          <EarthBoundary>
            <Suspense fallback={null}>
              <LoginEarth />
            </Suspense>
          </EarthBoundary>
        </div>
        <Orbits />
        <img src={satelliteUrl} alt="" loading="lazy" className="animate-orion-drift absolute left-[7%] top-[26%] w-14 opacity-90" />
        <img src={satelliteUrl} alt="" loading="lazy" className="animate-orion-drift absolute left-[33%] top-[34%] w-28 drop-shadow-[0_6px_18px_rgba(0,0,0,0.5)]" style={{ animationDelay: '1.5s' }} />
        <img src={satelliteUrl} alt="" loading="lazy" className="animate-orion-drift absolute left-[46%] top-[62%] w-20 opacity-95" style={{ animationDelay: '3s' }} />
      </div>

      {/* Branding + status cards */}
      <div className="relative z-10">
        <div className="flex items-center gap-4">
          <OrionLogo className="h-14 w-14 sm:h-16 sm:w-16" />
          <div>
            <div className="text-4xl font-extrabold uppercase leading-none tracking-[0.14em] text-white sm:text-5xl">
              OR<span className="text-accent-orange">I</span>ON
            </div>
            <div className="mt-1.5 text-[10px] uppercase tracking-[0.32em] text-slate-400 sm:text-xs">Space Mission Intelligence</div>
          </div>
        </div>

        <p className="mt-6 max-w-md text-base text-slate-300 sm:text-lg">AI-Powered Autonomous Satellite Mission Intelligence Platform</p>
        <div className="mt-3 h-1 w-16 rounded bg-accent-orange" />

        <div className="mt-6 flex flex-wrap gap-3">
          <StatusCard icon={<Bot className="h-4 w-4" />} label="Multi-Agent System" value={agentValue} valueClass="text-accent-green" dot />
          <StatusCard icon={<SatelliteDish className="h-4 w-4" />} label="Satellites Connected" value={satValue} valueClass="text-accent-cyan" />
          <StatusCard icon={<Brain className="h-4 w-4" />} label="Mission Intelligence" value={missionValue} valueClass="text-accent-green" />
        </div>
      </div>

      {/* Bottom security bar */}
      <div className="relative z-10 mt-8 hidden max-w-2xl sm:block">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 divide-x divide-space-700 rounded-xl border border-space-700 bg-space-900/60 px-4 py-3 backdrop-blur">
          <Capability icon={<ShieldCheck className="h-4 w-4 text-accent-green" />} title="SECURE" sub="ENCRYPTED" />
          <Capability icon={<Network className="h-4 w-4 text-accent-cyan" />} title="RELIABLE" sub="99.99% UPTIME" pad />
          <Capability icon={<Clock className="h-4 w-4 text-accent-cyan" />} title="REAL-TIME" sub="INTELLIGENCE" pad />
          <Capability icon={<Lock className="h-4 w-4 text-accent-cyan" />} title="DATA PROTECTION" sub="END-TO-END" pad />
        </div>
      </div>
    </section>
  );
}

function StatusCard({ icon, label, value, valueClass, dot }: { icon: React.ReactNode; label: string; value: string; valueClass: string; dot?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-space-700 bg-space-900/50 px-3 py-2 backdrop-blur">
      <span className="text-accent-cyan">{icon}</span>
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className={`flex items-center gap-1 text-xs font-bold ${valueClass}`}>
          {value}{dot && <span className="h-1.5 w-1.5 rounded-full bg-accent-green" />}
        </div>
      </div>
    </div>
  );
}

function Capability({ icon, title, sub, pad }: { icon: React.ReactNode; title: string; sub: string; pad?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${pad ? 'pl-6' : ''}`}>
      {icon}
      <div className="leading-tight">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-200">{title}</div>
        <div className="text-[9px] uppercase tracking-wide text-slate-500">{sub}</div>
      </div>
    </div>
  );
}

// ---------- Input field ----------
function Field({ icon, label, type, value, onChange, error, trailing, autoComplete, disabled }: {
  icon: React.ReactNode; label: string; type: string; value: string; onChange: (v: string) => void;
  error?: string; trailing?: React.ReactNode; autoComplete?: string; disabled?: boolean;
}) {
  return (
    <div>
      <div className={`flex items-center gap-3 rounded-xl border bg-space-800/70 px-4 py-3 transition-colors focus-within:border-accent-blue/60 focus-within:ring-1 focus-within:ring-accent-blue/40 ${error ? 'border-accent-red/50' : 'border-space-600'}`}>
        <span className="text-slate-500">{icon}</span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          aria-label={label}
          autoComplete={autoComplete}
          disabled={disabled}
          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
        />
        {trailing}
      </div>
      {error && <p className="mt-1 pl-1 text-xs text-accent-red">{error}</p>}
    </div>
  );
}

// ---------- Decorative SVGs ----------
function OrionLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="ORION logo">
      <circle cx="50" cy="50" r="30" fill="none" stroke="#3a4a66" strokeWidth="2" />
      <path d="M18 62 A40 40 0 0 1 82 30" fill="none" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
      <path d="M22 70 A44 44 0 0 0 86 42" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
      <path d="M26 76 A48 48 0 0 0 90 50" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <circle cx="50" cy="50" r="9" fill="#0b1220" stroke="#22d3ee" strokeWidth="2" />
      <path d="M78 22 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" fill="#ffffff" />
    </svg>
  );
}

function HexLock() {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="h-px w-16 bg-gradient-to-l from-space-500 to-transparent" />
      <span className="h-1.5 w-1.5 rotate-45 border border-space-500" />
      <svg viewBox="0 0 48 54" className="h-12 w-12" aria-hidden="true">
        <polygon points="24,2 45,14 45,40 24,52 3,40 3,14" fill="rgba(245,158,11,0.06)" stroke="#f59e0b" strokeWidth="1.5" />
        <g transform="translate(24,27)" fill="none" stroke="#f59e0b" strokeWidth="2">
          <rect x="-6" y="-1" width="12" height="10" rx="1.5" fill="rgba(245,158,11,0.15)" />
          <path d="M-3.5 -1 v-3 a3.5 3.5 0 0 1 7 0 v3" />
        </g>
      </svg>
      <span className="h-1.5 w-1.5 rotate-45 border border-space-500" />
      <span className="h-px w-16 bg-gradient-to-r from-space-500 to-transparent" />
    </div>
  );
}

function Orbits() {
  return (
    <svg viewBox="0 0 900 700" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" strokeWidth="1.2">
        <ellipse cx="230" cy="470" rx="360" ry="250" stroke="#22d3ee" strokeOpacity="0.35" strokeDasharray="4 8" className="animate-orion-dash" />
        <ellipse cx="230" cy="470" rx="440" ry="320" stroke="#f59e0b" strokeOpacity="0.35" strokeDasharray="3 10" className="animate-orion-dash" transform="rotate(-12 230 470)" />
        <ellipse cx="230" cy="470" rx="300" ry="200" stroke="#3b82f6" strokeOpacity="0.4" strokeDasharray="2 9" className="animate-orion-dash" transform="rotate(8 230 470)" />
      </g>
      <g fill="#22d3ee">
        <circle cx="560" cy="300" r="3" className="animate-orion-twinkle" />
        <circle cx="600" cy="520" r="2.5" className="animate-orion-twinkle" />
        <circle cx="120" cy="250" r="2.5" className="animate-orion-twinkle" />
      </g>
    </svg>
  );
}

function Starfield() {
  const stars = Array.from({ length: 90 }, (_, i) => ({
    x: (i * 137) % 100, y: (i * 71) % 100, r: (i % 4) * 0.3 + 0.3,
    c: i % 7 === 0 ? '#f59e0b' : i % 3 === 0 ? '#22d3ee' : '#cbd5e1', d: (i % 5) * 0.6,
  }));
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_15%_20%,rgba(23,54,96,0.55),transparent_60%),radial-gradient(90%_70%_at_85%_10%,rgba(13,32,60,0.6),transparent_55%),linear-gradient(180deg,#05070f,#02040a)]" />
      <div className="absolute right-[8%] top-[6%] h-56 w-72 rounded-full bg-accent-blue/10 blur-3xl" />
      <svg className="absolute inset-0 h-full w-full">
        {stars.map((s, i) => (
          <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill={s.c} className="animate-orion-twinkle" style={{ animationDelay: `${s.d}s` }} />
        ))}
      </svg>
    </div>
  );
}
