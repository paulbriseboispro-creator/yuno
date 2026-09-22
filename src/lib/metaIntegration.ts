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
 * Meta Business Suite — le seul écran de connexion Meta qui accepte un
 * identifiant Instagram.
 *
 * Meta laisse ouvrir un compte professionnel depuis Instagram seul. Ces pros
 * n'ont alors AUCUN profil Facebook, et Facebook Login for Business
 * authentifie un profil Facebook : le dialogue `facebook.com/dialog/oauth`
 * leur sert sa page de connexion Facebook (e-mail + mot de passe, « Créer un
 * compte »), sans aucune option Instagram. Vérifié en vrai le 2026-09-19.
 *
 * Ouvrir une session Business Suite avec Instagram NE débloque PAS le
 * dialogue : ce n'est pas un profil Facebook. Cette URL sert donc à deux
 * choses, et pas à contourner l'autorisation :
 *   1. ajouter un profil Facebook comme administrateur du portefeuille —
 *      après quoi « Connecter avec Facebook » marche et tout s'ouvre
 *      (pixel, API Conversions, publicités pilotées depuis Yuno) ;
 *   2. atteindre Events Manager pour relever l'identifiant du pixel et
 *      générer un jeton Conversions API, et brancher Yuno en mode avancé —
 *      le suivi des ventes marche, les publicités depuis Yuno non.
 *
 * « Business Login for Instagram » (`instagram.com/oauth/authorize`) n'est
 * pas une troisième voie : ses scopes `instagram_business_*` couvrent
 * messages et contenus, jamais `ads_management` ni le pixel.
 */
export const META_BUSINESS_LOGIN_URL = 'https://business.facebook.com/';

/**
 * Comptes pros bêta qui voient les pages Meta live avant l'ouverture générale
 * (le compte organisateur Amoris de Paul, un club testeur…). Emails en
 * minuscules. Aucun secret ici : ça n'ouvre que l'interface, l'autorisation
 * reste côté serveur (propriétaire du club / organisateur lui-même).
 */
export const META_BETA_EMAILS: string[] = [
	'paul.brisebois.pro@gmail.com',
	'amoris.society@gmail.com',
];

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

/**
 * Avertissement d'avant-ouverture : l'app Yuno est en mode Développement chez
 * Meta tant que l'App Review n'est pas accordée, et Meta ne laisse alors
 * passer le dialogue qu'aux profils Facebook qui ont un RÔLE sur l'app
 * (administrateur, développeur, testeur). Un profil sans rôle ne reçoit pas
 * une erreur d'autorisation : il tombe sur une page « Feature unavailable —
 * … we are updating additional details for this app », qui ressemble à une
 * panne de Yuno alors que c'est l'état de l'app Meta. Constaté le 2026-09-20,
 * et ce sera vrai pour chaque nouveau compte de test jusqu'à l'ouverture.
 *
 * Volontairement CACHÉ aux comptes démo : c'est avec eux que le reviewer Meta
 * teste, et lui annoncer que l'app est en Développement n'a aucun sens. Ne
 * reste donc que le super admin et les comptes bêta, qui eux administrent
 * l'app Meta.
 *
 * Disparaît tout seul quand `META_INTEGRATION_LIVE` passe à `true`.
 */
export function useMetaDevModeNotice(): boolean {
  const { user } = useAuth();
  const live = useMetaIntegrationLive();
  if (META_INTEGRATION_LIVE || !live || !user) return false;
  return !isDemoEmail(user.email);
}
