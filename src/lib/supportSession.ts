// Accès assisté Yuno (« mode support ») — couche front.
//
// Un super admin ouvre une session GoTrue POUR un pro consentant (edge
// `admin-account-recovery`, action open-support-session). La session est
// authentifiée COMME le pro : côté base, les triggers de garde la reconnaissent
// au claim JWT `session_id` (migration 20260824120000) et refusent toute
// écriture sur les données d'argent, d'identité et de MFA.
//
// Ce module ne fait QUE la partie visible : mémoriser qu'on est en mode support
// (pour la bannière permanente et le garde MFA), et fermer proprement.
//
// Sécurité : le drapeau localStorage n'est PAS la protection — il est
// falsifiable et ne sert qu'à l'affichage. Toutes les vraies interdictions sont
// côté serveur (triggers SQL + gardes edge functions), donc un drapeau effacé à
// la main ne débloque rien.

import { supabase } from '@/integrations/supabase/client';

const KEY = 'yunoSupportSession';

export interface SupportSessionState {
  sessionId: string;
  grantId?: string;
  targetUserId: string;
  targetName: string;
  expiresAt: string;
}

/**
 * Cette erreur est-elle un refus de verrou d'assistance ?
 *
 * Sans ce test, un refus remonte en « erreur inconnue » : en plein montage de
 * soirée, on croit à un bug de l'app et on recommence trois fois. Le refus est
 * volontaire, il doit se lire comme tel.
 */
export function isSupportForbidden(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string };
  return e.code === 'P0403' || (e.message ?? '').includes('support_session_forbidden');
}

/** Message à afficher quand un verrou d'assistance a refusé une écriture. */
export function supportForbiddenMessage(lang: string): string {
  if (lang === 'en') return 'Blocked in assisted mode: this belongs to the account owner (payments, bank details, login email, PIN or two-factor). Ask them to do it themselves.';
  if (lang === 'es') return 'Bloqueado en modo asistido: esto pertenece al titular de la cuenta (pagos, datos bancarios, email de acceso, PIN o doble factor). Pídeselo a él.';
  return "Bloqué en mode assistance : ceci appartient au titulaire du compte (paiements, coordonnées bancaires, email de connexion, code PIN ou 2FA). C'est à lui de le faire.";
}

export function getSupportSession(): SupportSessionState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SupportSessionState;
    if (!parsed?.sessionId || !parsed?.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isSupportSessionActive(): boolean {
  return getSupportSession() !== null;
}

export function setSupportSession(state: SupportSessionState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* localStorage indispo : la bannière ne s'affichera pas, les verrous serveur tiennent */ }
}

export function clearSupportSessionFlag(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

/**
 * Ferme la session support : clôture serveur (la session cesse d'être reconnue
 * par les gardes) puis déconnexion locale. Best-effort côté serveur — même si
 * l'appel échoue, on déconnecte et la session expire d'elle-même (12 h max).
 */
export async function endSupportSession(): Promise<void> {
  try {
    await supabase.functions.invoke('admin-account-recovery', {
      body: { action: 'end-support-session' },
    });
  } catch { /* le signOut ci-dessous reste la sortie sûre */ }
  clearSupportSessionFlag();
  try {
    localStorage.removeItem('mfaSession');
    localStorage.removeItem('pinSession');
    localStorage.removeItem('staffSession');
  } catch { /* ignore */ }
  // `scope: 'local'` impérativement : la session est celle DU PRO. Un signOut
  // global (le défaut de supabase-js) révoquerait tous ses refresh tokens —
  // son téléphone à la porte, la tablette du bar, tout, en pleine soirée.
  // La session support elle-même est révoquée côté serveur juste au-dessus.
  await supabase.auth.signOut({ scope: 'local' });
}
