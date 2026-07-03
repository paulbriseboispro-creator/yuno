// Helpers de session démo partagés entre DemoSwitcher (bascule 1-clic pour Paul)
// et PreviewGate (lien de preview verrouillé par mot de passe envoyé à un prospect).
//
// Ces bypass posent, en localStorage, les sessions locales qui satisfont les gardes
// de rôle (RequireMFA / RequirePinSession / RequireStaffSession) SANS jamais toucher
// au vrai secret 2FA ni exiger un PIN — indispensable car verify-pin / verify-mfa
// sont CORS-lock yunoapp.eu / non déployées. Aucun impact prod : seuls les comptes
// démo @womber.fr empruntent ces chemins.

import { supabase } from '@/integrations/supabase/client';

// Types de compte démo exposables via un lien de preview (miroir des ACCOUNTS du
// DemoSwitcher + du CHECK de la table demo_preview_links).
export type TargetAccount =
  | 'owner' | 'organizer' | 'bde' | 'promoter' | 'agency'
  | 'dj' | 'affiliate' | 'bouncer' | 'barman' | 'cloakroom' | 'vip_host';

export interface DemoAccountMeta {
  email: string;
  /** Libellé humain (fenêtre admin). */
  label: string;
  /** Route d'atterrissage après connexion. */
  route: string;
  /** Session locale à poser pour passer le garde du rôle sans étape PIN. */
  session?: 'staff' | 'pin';
  role?: string;
}

// Source de vérité unique : type de compte → email démo → route → bypass.
export const DEMO_ACCOUNTS: Record<TargetAccount, DemoAccountMeta> = {
  owner:     { email: 'owner@womber.fr',     label: 'Club (Owner)',       route: '/owner/dashboard' },
  organizer: { email: 'organizer@womber.fr', label: 'Organisateur / BDE', route: '/organizer-app' },
  bde:       { email: 'bde@womber.fr',       label: 'BDE (étudiants)',    route: '/organizer-app' },
  promoter:  { email: 'promoter@womber.fr',  label: 'Promoteur',          route: '/promoter',   session: 'pin',   role: 'promoter' },
  agency:    { email: 'agency@womber.fr',    label: 'Agence promoteurs',  route: '/agency-app' },
  dj:        { email: 'dj@womber.fr',        label: 'DJ',                 route: '/dj',         session: 'pin',   role: 'dj' },
  affiliate: { email: 'affiliate@womber.fr', label: 'Affilié',            route: '/affiliate' },
  bouncer:   { email: 'bouncer@womber.fr',   label: 'Videur (porte)',     route: '/bouncer',    session: 'staff', role: 'bouncer' },
  barman:    { email: 'barman@womber.fr',    label: 'Barman',             route: '/barman',     session: 'staff', role: 'barman' },
  cloakroom: { email: 'cloakroom@womber.fr', label: 'Vestiaire',          route: '/cloakroom',  session: 'staff', role: 'cloakroom' },
  vip_host:  { email: 'viphost@womber.fr',   label: 'Hôte VIP',           route: '/vip-host',   session: 'staff', role: 'vip_host' },
};

export const ALL_TARGET_ACCOUNTS = Object.keys(DEMO_ACCOUNTS) as TargetAccount[];

// Mot de passe partagé des comptes démo (throwaway, club masqué, données fictives).
// Déjà public dans le bundle (DemoSwitcher) et le seed — centralisé ici pour être
// réutilisé par le switch de rôles en aperçu.
export const DEMO_PASSWORD = 'YunoDemo2026!';

// Comptes dont la route exige RequireMFA (owner, affilié). On pose une session MFA
// locale valide 24 h pour ne pas tomber sur /mfa-setup en démo.
export const MFA_GATED = new Set(['owner@womber.fr', 'affiliate@womber.fr']);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pose une session MFA locale valide 24 h (sans toucher au vrai secret 2FA). */
export function setMfaBypass(userId: string | undefined): void {
  if (!userId) return;
  try {
    localStorage.setItem('mfaSession', JSON.stringify({
      userId, expiresAt: Date.now() + DAY_MS, verifiedAt: Date.now(),
    }));
  } catch { /* localStorage indispo : ignore */ }
}

/**
 * Pose la session locale qui satisfait RequireStaffSession / RequirePinSession,
 * pour éviter l'étape PIN. `staff` → localStorage.staffSession (avec venue_id) ;
 * `pin` → localStorage.pinSession.
 */
export async function setRoleSessionBypass(
  account: Pick<DemoAccountMeta, 'session' | 'role'>,
  userId: string | undefined,
): Promise<void> {
  const expiresAt = Date.now() + DAY_MS;
  try {
    if (account.session === 'staff' && account.role) {
      let venueId: string | null = null;
      if (userId) {
        const { data } = await supabase.from('profiles').select('venue_id').eq('id', userId).maybeSingle();
        venueId = data?.venue_id ?? null;
      }
      localStorage.setItem('staffSession', JSON.stringify({ venueId, role: account.role, expiresAt, verifiedAt: Date.now() }));
    } else if (account.session === 'pin' && account.role) {
      localStorage.setItem('pinSession', JSON.stringify({ role: account.role, expiresAt, verifiedAt: Date.now() }));
    }
  } catch { /* localStorage indispo : ignore */ }
}

/** Applique le bon bypass (MFA / staff / pin) pour un type de compte donné. */
export async function applyDemoBypass(target: TargetAccount, userId: string | undefined): Promise<void> {
  const meta = DEMO_ACCOUNTS[target];
  if (!meta) return;
  if (MFA_GATED.has(meta.email)) setMfaBypass(userId);
  await setRoleSessionBypass(meta, userId);
}

/**
 * Bascule client-side vers un autre compte démo (switch de rôles en aperçu).
 * Réutilise le mécanisme du DemoSwitcher : signInWithPassword avec le mot de passe
 * démo (déjà public) puis pose les bypass du rôle. Renvoie false en cas d'échec.
 */
export async function switchToDemoRole(target: TargetAccount): Promise<boolean> {
  const meta = DEMO_ACCOUNTS[target];
  if (!meta) return false;
  const { data, error } = await supabase.auth.signInWithPassword({ email: meta.email, password: DEMO_PASSWORD });
  if (error || !data.user) return false;
  await applyDemoBypass(target, data.user.id);
  return true;
}

/** Nettoie toutes les sessions de bypass démo (déconnexion / sortie d'aperçu). */
export function clearDemoBypass(): void {
  try {
    localStorage.removeItem('mfaSession');
    localStorage.removeItem('pinSession');
    localStorage.removeItem('staffSession');
  } catch { /* ignore */ }
}
