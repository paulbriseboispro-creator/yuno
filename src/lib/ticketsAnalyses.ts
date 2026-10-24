/**
 * Les Analyses de Yuno Tickets (`…/analyses`, copie des Analyses de Yuno CRM)
 * arrivent derrière un interrupteur, comme le veut le plan de transposition
 * (décision D8 du 17/10) : le super admin et les comptes démo d'abord, tous
 * les comptes quand Paul les valide (TIX_ANALYSES_LIVE = true, fait le 24/10 :
 * lot 8, l'ancienne Analytics renvoie vers les Analyses). Les adresses
 * répondent pour tout le monde : l'interrupteur ne règle que l'entrée du menu.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { isDemoEmail } from '@/lib/demoPlan';

export const TIX_ANALYSES_LIVE = true;

let superAdminCache: boolean | null = null;

export function useTixAnalysesLive(): boolean {
  const { user } = useAuth();
  const [superAdmin, setSuperAdmin] = useState<boolean>(superAdminCache === true);
  useEffect(() => {
    if (TIX_ANALYSES_LIVE || !user || superAdminCache !== null) return;
    let cancelled = false;
    supabase.rpc('is_super_admin').then(({ data }) => {
      superAdminCache = data === true;
      if (!cancelled) setSuperAdmin(superAdminCache);
    });
    return () => { cancelled = true; };
  }, [user]);
  if (TIX_ANALYSES_LIVE) return true;
  if (!user) return false;
  return superAdmin || isDemoEmail(user.email);
}
