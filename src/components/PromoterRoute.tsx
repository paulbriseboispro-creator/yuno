import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { RequirePinSession } from './RequirePinSession';

interface PromoterRouteProps {
  children: React.ReactNode;
}

export function PromoterRoute({ children }: PromoterRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [isPromoter, setIsPromoter] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkPromoterStatus() {
      if (!user) {
        setChecking(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'promoter')
          .maybeSingle();

        if (error) {
          console.error('Error checking promoter role:', error);
          setIsPromoter(false);
        } else {
          setIsPromoter(!!data);
        }
      } catch (error) {
        console.error('Error in checkPromoterStatus:', error);
        setIsPromoter(false);
      } finally {
        setChecking(false);
      }
    }

    if (!loading) {
      checkPromoterStatus();
    }
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

  if (!isPromoter) {
    return <Navigate to="/" replace />;
  }

  return (
    <RequirePinSession allowedRoles={['promoter']} dashboardPath="/promoter">
      {children}
    </RequirePinSession>
  );
}
