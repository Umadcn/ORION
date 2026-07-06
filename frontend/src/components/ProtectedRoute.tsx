import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { canAccess } from '../auth/permissions';

/**
 * Guards protected routes. Redirects unauthenticated users to /login (keeping
 * the intended destination), and users lacking a role for the route back to the
 * dashboard. While the session is being restored it shows a spinner.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-space-950 text-slate-400">
        <div className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Restoring session…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!canAccess(user.role, location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
