/**
 * Intégration Meta (Pixel + Conversions API, connexion Facebook Login for
 * Business, publicité pilotée depuis Yuno) — interrupteur « en construction ».
 *
 * Tant que `META_INTEGRATION_LIVE` est à `false`, la carte Meta (Réglages →
 * Intégrations) et la page Publicité des clubs et organisateurs affichent un
 * état « En construction » : le pro voit ce qui arrive, rien ne part.
 *
 * Exceptions, via `useMetaIntegrationLive()` : le super admin et les comptes
 * DÉMO (`@womber.fr`) voient les vraies pages. C'est ce qui permet de filmer
 * les vidéos de l'App Review et de laisser le reviewer Meta tester sur le
 * club démo avant que la feature soit ouverte à tous. La carte de la
 * plateforme (/admin/system) est toujours active.
 *
 * À passer à `true` une fois la checklist de docs/META_GO_LIVE_GUIDE.md
 * terminée : app Meta en mode Live, App Review accordée, parcours validé
 * sur un vrai compte pro.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';

export const META_INTEGRATION_LIVE = false;

/**
 * Comptes pros bêta qui voient les pages Meta live avant l'ouverture générale
 * (le compte organisateur Amoris de Paul, un club testeur…). Emails en
 * minuscules. Aucun secret ici : ça n'ouvre que l'interface, l'autorisation
 * reste côté serveur (propriétaire du club / organisateur lui-même).
 */
export const META_BETA_EMAILS: string[] = ['paul.brisebois.pro@gmail.com'];

let superAdminCache: boolean | null = null;

/** Live pour tout le monde, ou pour le super admin et les comptes démo (tournage + reviewer). */
export function useMetaIntegrationLive(): boolean {
  const { user } = useAuth();
  const [superAdmin, setSuperAdmin] = useState<boolean>(superAdminCache === true);

  useEffect(() => {
    if (META_INTEGRATION_LIVE || !user || superAdminCache !== null) return;
    let cancelled = false;
    supabase.rpc('is_super_admin').then(({ data }) => {
      superAdminCache = data === true;
      if (!cancelled) setSuperAdmin(superAdminCache);
    });
    return () => { cancelled = true; };
  }, [user]);

  if (META_INTEGRATION_LIVE) return true;
  if (!user) return false;
  const email = (user.email ?? '').toLowerCase();
  return superAdmin || isDemoEmail(user.email) || META_BETA_EMAILS.includes(email);
}
