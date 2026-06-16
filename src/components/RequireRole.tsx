import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Role } from '@/types';

interface RequireRoleProps {
  children: React.ReactNode;
  allowedRoles: Role[];
}

export function RequireRole({ children, allowedRoles }: RequireRoleProps) {
  const { user, loading, roles } = useAuth();
  const location = useLocation();
  const [authChecked, setAuthChecked] = useState(false);
  const [hasValidStaffSession, setHasValidStaffSession] = useState(false);
  // Suspension : optimiste — on ne redirige que sur un `true` confirmé, jamais
  // sur une lecture lente/échouée (évite de verrouiller un compte légitime).
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    if (!user) { setSuspended(false); return; }
    let active = true;
    supabase.from('profiles').select('is_suspended').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (active && data?.is_suspended) setSuspended(true); });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    // Staff session is only valid if user is authenticated (PIN login creates Supabase session)
    if (user) {
      const staffSessionStr = sessionStorage.getItem('staffSession');
      if (staffSessionStr) {
        try {
          const staffSession = JSON.parse(staffSessionStr);
          // Validate: not expired AND role matches allowed roles
          if (staffSession.expiresAt > Date.now()) {
            const staffRoleAllowed = allowedRoles.includes(staffSession.role as Role);
            const isOwnerAllowed = allowedRoles.includes('owner') && staffSession.role === 'owner';
            if (staffRoleAllowed || isOwnerAllowed) {
              setHasValidStaffSession(true);
            }
          } else {
            // Session expired, clean it up
            sessionStorage.removeItem('staffSession');
          }
        } catch {
          sessionStorage.removeItem('staffSession');
        }
      }
    }

    // Wait a bit to ensure roles are loaded
    if (!loading) {
      const timer = setTimeout(() => setAuthChecked(true), 100);
      return () => clearTimeout(timer);
    }
  }, [loading, allowedRoles, user]);

  if (loading || !authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // User must be authenticated - no bypass without Supabase session
  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Compte suspendu par un admin → page dédiée (coupe l'accès pro).
  if (suspended) {
    return <Navigate to="/account-suspended" replace />;
  }

  // If valid staff session exists (user is authenticated via PIN + Supabase), allow access
  if (hasValidStaffSession) {
    return <>{children}</>;
  }

  const hasAllowedRole = allowedRoles.some(role => roles.includes(role));

  if (!hasAllowedRole) {
    // Don't redirect immediately if roles are still loading
    if (roles.length === 0) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      );
    }
    
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
