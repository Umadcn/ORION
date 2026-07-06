import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../api/client';
import { clearToken, loadToken, saveToken } from './storage';
import type { AuthUser } from '../types';

interface AuthState {
  user: AuthUser | null;
  loading: boolean; // true during initial session restore
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const bootstrapped = useRef(false);

  // Restore a persisted session on first load by validating the token via /me.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    // On any 401 from a protected call, drop the session.
    setUnauthorizedHandler(() => {
      clearToken();
      setAuthToken(null);
      setUser(null);
    });

    const token = loadToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setAuthToken(token);
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => {
        clearToken();
        setAuthToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));

    return () => setUnauthorizedHandler(null);
  }, []);

  const login = async (username: string, password: string, remember: boolean) => {
    const res = await api.login(username, password);
    saveToken(res.access_token, remember);
    setAuthToken(res.access_token);
    setUser(res.user);
  };

  const logout = () => {
    // Best-effort server notify; JWT is stateless so client-side clear is authoritative.
    api.logout().catch(() => {});
    clearToken();
    setAuthToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
