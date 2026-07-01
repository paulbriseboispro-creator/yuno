import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface AgencyRouteProps {
  children: React.ReactNode;
}

/**
 * Guards the autonomous agency app. Grants access to users holding the
 * `agency` role (owner of a promoter agency). Mirrors PromoterRoute.
 */
export function AgencyRoute({ children }: AgencyRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [isAgency, setIsAgency] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAgencyRole() {
      if (!user) {
        setChecking(false);
        return;
      }
      try {
        const { data, error } = await (supabase as any)
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'agency')
          .maybeSingle();
        setIsAgency(!error && !!data);
      } catch {
        setIsAgency(false);
      } finally {
        setChecking(false);
      }
    }
    if (!loading) checkAgencyRole();
  }, [user, loading]);

  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (!isAgency) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
