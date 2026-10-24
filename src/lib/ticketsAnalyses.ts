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

/**
 * Les écrans Clients, Segments, Imports de Yuno Tickets (`…/clients`, copie
 * de ceux de Yuno CRM, migration 20261109400000) : même règle, interrupteur
 * à part (TIX_CLIENTS_LIVE). L'ancienne page Clients (`…/customers`) reste
 * en place jusqu'à la validation de Paul.
 */
export const TIX_CLIENTS_LIVE = false;

export function useTixAnalysesLive(): boolean {
  return useTixPreview(TIX_ANALYSES_LIVE);
}

export function useTixClientsLive(): boolean {
  return useTixPreview(TIX_CLIENTS_LIVE);
}

/** Ouvert à tous quand `live`, sinon au super admin et aux comptes démo. */
function useTixPreview(live: boolean): boolean {
  const { user } = useAuth();
  const [superAdmin, setSuperAdmin] = useState<boolean>(superAdminCache === true);
  useEffect(() => {
    if (live || !user || superAdminCache !== null) return;
    let cancelled = false;
    supabase.rpc('is_super_admin').then(({ data }) => {
      superAdminCache = data === true;
      if (!cancelled) setSuperAdmin(superAdminCache);
    });
    return () => { cancelled = true; };
  }, [user, live]);
  if (live) return true;
  if (!user) return false;
  return superAdmin || isDemoEmail(user.email);
}
