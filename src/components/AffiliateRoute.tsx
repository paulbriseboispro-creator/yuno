import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { RequireMFA } from './RequireMFA';
import { RequirePinSession } from './RequirePinSession';

interface AffiliateRouteProps {
  children: React.ReactNode;
}

type AffiliateType = 'admin' | 'member' | null;

export function AffiliateRoute({ children }: AffiliateRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [isAffiliate, setIsAffiliate] = useState<boolean | null>(null);
  const [affiliateType, setAffiliateType] = useState<AffiliateType>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkAffiliateStatus() {
      if (!user) {
        setChecking(false);
        return;
      }

      try {
        // Accept both 'affiliate' (admin) and 'affiliate_member' (promoter)
        const { data: roleData, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .in('role', ['affiliate', 'affiliate_member']);

        if (error) {
          console.error('Error checking affiliate role:', error);
          setIsAffiliate(false);
          setChecking(false);
          return;
        }

        const roles = (roleData ?? []).map(r => r.role);
        if (roles.length === 0) {
          setIsAffiliate(false);
          setChecking(false);
          return;
        }

        setIsAffiliate(true);

        // Admins have a record in `affiliates`; members only in `affiliate_members`
        const { data: adminData } = await supabase
          .from('affiliates')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        setAffiliateType(adminData ? 'admin' : 'member');
      } catch (error) {
        console.error('Error in checkAffiliateStatus:', error);
        setIsAffiliate(false);
      } finally {
        setChecking(false);
      }
    }

    if (!loading) {
      checkAffiliateStatus();
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

  if (!isAffiliate) {
    return <Navigate to="/" replace />;
  }

  if (affiliateType === 'member') {
    return (
      <RequirePinSession allowedRoles={['affiliate', 'affiliate_member']} dashboardPath="/affiliate">
        {children}
      </RequirePinSession>
    );
  }

  return (
    <RequireMFA requiredRole="affiliate">
      {children}
    </RequireMFA>
  );
}
