import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Role } from '@/types';
import { Shimmer, SkeletonLine } from '@/components/skeletons/Shimmer';

interface RequireRoleProps {
  children: React.ReactNode;
  allowedRoles: Role[];
}

/* Le garde de rôle affichait un spinner plein écran, donc CHAQUE ouverture de
   /favorites, /profile ou /settings commençait par un disque qui tourne — c'est
   ce que l'utilisateur voyait avant même que la page ait la parole. On rend à la
   place la silhouette d'une page : titre, puis liste. La barre d'onglets, elle,
   vit désormais hors du <Routes> et reste visible par-dessus (PersistentBottomNav). */
function RoleGateSkeleton() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <div className="px-5 pt-14 pb-5">
        <SkeletonLine width="45%" height={26} />
      </div>
      <div className="px-4 flex flex-col gap-3">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="flex items-center gap-4 p-3.5 rounded-2xl"
            style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Shimmer width={56} height={56} style={{ flex: 'none', borderRadius: 14 }} />
            <div className="flex-1 min-w-0 flex flex-col gap-2.5">
              <SkeletonLine width="55%" height={15} />
              <SkeletonLine width="32%" height={12} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RequireRole({ children, allowedRoles }: RequireRoleProps) {
  const { user, loading, roles } = useAuth();
  const location = useLocation();
  const [authChecked, setAuthChecked] = useState(false);
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
    // Ménage de la session PIN expirée (écrite dans localStorage par
    // RequireStaffSession). Ce garde-ci ne s'appuie PAS dessus pour autoriser :
    // le blob est modifiable côté client, seul le rôle en base fait foi.
    // La vérification du PIN elle-même vit dans RequireStaffSession.
    if (user) {
      const staffSessionStr = localStorage.getItem('staffSession');
      if (staffSessionStr) {
        try {
          if (JSON.parse(staffSessionStr).expiresAt <= Date.now()) {
            localStorage.removeItem('staffSession');
          }
        } catch {
          localStorage.removeItem('staffSession');
        }
      }
    }

    // Wait a bit to ensure roles are loaded
    if (!loading) {
      const timer = setTimeout(() => setAuthChecked(true), 100);
      return () => clearTimeout(timer);
    }
  }, [loading, user]);

  if (loading || !authChecked) {
    return (
      <RoleGateSkeleton />
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

  const hasAllowedRole = allowedRoles.some(role => roles.includes(role));

  if (!hasAllowedRole) {
    // Don't redirect immediately if roles are still loading
    if (roles.length === 0) {
      return (
        <RoleGateSkeleton />
      );
    }

    // Rôles chargés et aucun ne correspond : la session PIN ne rattrape rien.
    // Un employé licencié garde son blob 24 h après la révocation de son rôle.
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
