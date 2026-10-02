/**
 * Yuno CRM — interrupteurs du deuxième produit (plan : docs/designs/YUNO_CRM_PLAN.md).
 *
 * `CRM_CONNECTORS_LIVE` ouvre à tous les pros la carte « Billetterie
 * connectée » (Réglages → Intégrations). Tant qu'il est à `false`, seuls la
 * voient : le super admin, les comptes démo (`@womber.fr`) et les comptes bêta
 * ci-dessous — exactement le modèle de `metaIntegration.ts`. Une connexion
 * Shotgun ne change rien d'autre au compte tant que le lot 2 (branchement au
 * CRM) n'est pas livré : on peut donc l'ouvrir en bêta sans risque.
 *
 * Aucun secret ici : l'interface seule s'ouvre, l'autorisation reste serveur
 * (`ticketing_scope_allowed` : propriétaire du club, organisateur lui-même,
 * super admin).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';

export const CRM_CONNECTORS_LIVE = false;

/** Comptes pros bêta (emails en minuscules). */
export const CRM_BETA_EMAILS: string[] = [
  'paul.brisebois.pro@gmail.com',
  'amoris.society@gmail.com',
];

let superAdminCache: boolean | null = null;

export function useTicketingConnectorsLive(): boolean {
  const { user } = useAuth();
  const [superAdmin, setSuperAdmin] = useState<boolean>(superAdminCache === true);

  useEffect(() => {
    if (CRM_CONNECTORS_LIVE || !user || superAdminCache !== null) return;
    let cancelled = false;
    supabase.rpc('is_super_admin').then(({ data }) => {
      superAdminCache = data === true;
      if (!cancelled) setSuperAdmin(superAdminCache);
    });
    return () => { cancelled = true; };
  }, [user]);

  if (CRM_CONNECTORS_LIVE) return true;
  if (!user) return false;
  const email = (user.email ?? '').toLowerCase();
  return superAdmin || isDemoEmail(user.email) || CRM_BETA_EMAILS.includes(email);
}

/** Où trouver l'ID organisateur et le jeton (article officiel Shotgun). */
export const SHOTGUN_TOKEN_HELP_URL =
  'https://support-pro.shotgun.live/hc/fr/articles/33561354477970-Trouvez-votre-ID-organisateur-et-votre-jeton-API';
