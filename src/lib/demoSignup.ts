// Démo → vrai compte (migration 20260926120000).
//
// Le super admin prépare un compte (club ou organisateur, prénom, nom de la
// structure, email…) sur un lien d'aperçu démo. Après le mot de passe du lien,
// l'edge de redeem rend ce brouillon ; la démo affiche alors la barre
// « Crée le compte de <orga> » (DemoSignupBar) et le dialogue de création
// (DemoSignupDialog). Ce module porte la mécanique, sans UI.
//
// La création se fait dans un client Supabase JETABLE, sans persistance :
// tant que le compte n'est pas ouvert, l'onglet reste connecté au compte démo
// et l'aperçu lecture seule reste armé. Un échec (email déjà pris, mot de
// passe trop court, réseau) laisse le prospect dans la démo, formulaire
// intact. Ce n'est qu'une fois le club / l'espace orga ouvert que la session
// neuve remplace la session démo dans le vrai client, puis la page recharge
// sur /get-started — la même arrivée qu'un inscrit de la landing.

import { createClient, type Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { disablePreviewMode } from '@/contexts/PreviewModeContext';
import { clearDemoBypass } from '@/lib/demoSession';
import { recordLegalAcceptance } from '@/lib/legal';
import { publicUrl } from '@/lib/native';
import { PENDING_SIGNUP_KEY, isValidSignupKey } from '@/lib/proSignup';

export type DemoSignupKind = 'club' | 'organizer';

/** Brouillon rendu par l'edge de redeem (RPC demo_preview_link_signup). */
export interface DemoSignupPrefill {
  /** Le compte a déjà été ouvert depuis ce lien. */
  created: boolean;
  /** Clé du parcours pro_signups — absente quand le compte existe déjà. */
  key: string | null;
  kind: DemoSignupKind;
  firstName: string;
  lastName: string;
  email: string;
  orgName: string;
  city: string;
  /** Paul propose l'accès assisté (configuration par l'équipe Yuno). */
  offerSupport: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Valide ce qui arrive du serveur (ou de sessionStorage) — jamais de confiance aveugle. */
export function parseDemoSignup(raw: unknown): DemoSignupPrefill | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind === 'club' || o.kind === 'organizer' ? o.kind : null;
  if (!kind) return null;
  const created = o.created === true;
  const key = isValidSignupKey(str(o.key)) ? str(o.key) : null;
  // Sans clé, un brouillon non ouvert ne peut rien créer : pas de barre.
  if (!created && !key) return null;
  return {
    created,
    key: created ? null : key,
    kind,
    firstName: str(o.first_name ?? o.firstName),
    lastName: str(o.last_name ?? o.lastName),
    email: str(o.email),
    orgName: str(o.org_name ?? o.orgName),
    city: str(o.city),
    offerSupport: o.offer_support !== false && o.offerSupport !== false,
  };
}

/** Forme stockée dans l'état d'aperçu (sessionStorage de l'onglet). */
export function serializeDemoSignup(s: DemoSignupPrefill): Record<string, unknown> {
  return {
    created: s.created,
    key: s.key,
    kind: s.kind,
    first_name: s.firstName,
    last_name: s.lastName,
    email: s.email,
    org_name: s.orgName,
    city: s.city,
    offer_support: s.offerSupport,
  };
}

export const MIN_PASSWORD_LENGTH = 8;

export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
}

export type DemoSignupError =
  | 'exists' //          email déjà inscrit → demander son mot de passe Yuno
  | 'wrong_password' //  connexion au compte existant refusée
  | 'weak_password'
  | 'invalid_email'
  | 'confirm_email' //   la confirmation d'email est exigée : lien envoyé
  | 'demo_account' //    email d'un compte démo
  | 'already_used' //    ce brouillon a déjà ouvert un AUTRE compte
  | 'rate_limited'
  | 'unknown';

/** Traduit une erreur GoTrue en code stable (jamais le message brut à l'écran). */
export function authErrorCode(err: { message?: string; code?: string; status?: number } | null | undefined): DemoSignupError {
  if (!err) return 'unknown';
  const code = String(err.code ?? '').toLowerCase();
  const msg = String(err.message ?? '').toLowerCase();
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered') || msg.includes('already been registered')) return 'exists';
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'wrong_password';
  if (code === 'weak_password' || msg.includes('password should') || msg.includes('weak password')) return 'weak_password';
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'confirm_email';
  if (code === 'email_address_invalid' || code === 'validation_failed' || msg.includes('invalid email') || msg.includes('is invalid')) return 'invalid_email';
  if (code.includes('rate_limit') || err.status === 429 || msg.includes('rate limit')) return 'rate_limited';
  return 'unknown';
}

/** Erreur des RPC d'ouverture (RAISE EXCEPTION '<code>'). */
export function completeErrorCode(message: string | undefined): DemoSignupError {
  const m = String(message ?? '');
  if (m.includes('demo_account')) return 'demo_account';
  if (m.includes('already_used')) return 'already_used';
  return 'unknown';
}

export interface OpenDemoAccountInput {
  prefill: DemoSignupPrefill;
  mode: 'signup' | 'signin';
  firstName: string;
  lastName: string;
  orgName: string;
  email: string;
  password: string;
  supportHelp: boolean;
  language: 'en' | 'fr' | 'es';
  /** Texte des CGU acceptées (hashé pour preuve, comme à l'inscription client). */
  cguContent?: string;
}

/** `ok` : la page recharge sur /get-started. Sinon `error` dit pourquoi. */
export interface OpenDemoAccountResult {
  ok: boolean;
  error?: DemoSignupError;
}

function scratchClient() {
  return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'yuno-demo-signup',
    },
  });
}

/**
 * Crée (ou retrouve) le compte, ouvre le club / l'espace orga, puis quitte la
 * démo pour /get-started. Ne rend la main qu'en cas d'échec : en cas de
 * succès la page recharge.
 */
export async function openDemoAccount(input: OpenDemoAccountInput): Promise<OpenDemoAccountResult> {
  const { prefill } = input;
  const key = prefill.key;
  if (!key) return { ok: false, error: 'unknown' };
  const email = input.email.trim().toLowerCase();
  if (!isPlausibleEmail(email)) return { ok: false, error: 'invalid_email' };
  if (/@womber\.fr$/i.test(email)) return { ok: false, error: 'demo_account' };

  const sb = scratchClient();

  // Ce que la personne a corrigé dans le formulaire devient le brouillon
  // (prénom, nom de la structure, email) — complete_pro_signup le lit ensuite.
  // Mesure seulement : un échec ici n'arrête rien.
  try {
    await sb.rpc('track_pro_signup', {
      p_key: key,
      p_step: 'account',
      p_data: {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        org_name: input.orgName.trim(),
        email,
        lang: input.language,
      },
    });
  } catch { /* ignore */ }

  let session: Session | null = null;
  if (input.mode === 'signup') {
    const { data, error } = await sb.auth.signUp({
      email,
      password: input.password,
      options: {
        // Si la confirmation d'email est un jour exigée, le lien finit
        // l'ouverture tout seul (GetStarted lit ?key=).
        emailRedirectTo: publicUrl(`/get-started?key=${key}`),
        data: {
          first_name: input.firstName.trim() || undefined,
          last_name: input.lastName.trim() || undefined,
        },
      },
    });
    if (error) return { ok: false, error: authErrorCode(error) };
    // Confirmation exigée + email existant : GoTrue masque le doublon en
    // rendant un utilisateur sans identité.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, error: 'exists' };
    }
    session = data.session;
    if (!session) return { ok: false, error: 'confirm_email' };
  } else {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: input.password });
    if (error) return { ok: false, error: authErrorCode(error) };
    session = data.session;
  }
  if (!session) return { ok: false, error: 'unknown' };

  const { error: cErr } = await sb.rpc('complete_demo_preview_signup', {
    p_key: key,
    p_support_help: input.supportHelp && prefill.offerSupport,
  });
  const code = cErr ? completeErrorCode(cErr.message) : null;
  // Ces deux refus viennent d'un compte qui ne doit PAS recevoir la session
  // de la démo : on s'arrête là, le prospect reste dans l'aperçu.
  if (code === 'demo_account' || code === 'already_used') return { ok: false, error: code };

  // Le compte existe : il remplace la session démo dans le vrai client.
  const { error: sErr } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (sErr) return { ok: false, error: 'unknown' };

  disablePreviewMode();
  clearDemoBypass();
  try {
    localStorage.setItem('language', input.language);
    localStorage.setItem('languageSelected', 'true');
    // Un pro ne voit jamais les étapes d'accueil CLIENT (OnboardingGate teste
    // la chaîne exacte 'true'), comme après le handoff de la landing.
    localStorage.setItem('onboarding_language_answered', 'true');
    localStorage.setItem('onboarding_taste_answered', 'true');
    localStorage.setItem('onboarding_push_answered', 'true');
    // Ouverture non aboutie (panne passagère) : /get-started la rejoue.
    if (cErr) localStorage.setItem(PENDING_SIGNUP_KEY, key);
  } catch { /* stockage indisponible : sans conséquence */ }

  if (input.mode === 'signup') {
    await recordLegalAcceptance({
      docType: 'cgu',
      docContent: input.cguContent,
      email,
      context: { surface: 'demo_signup', privacy_shown: true, kind: prefill.kind },
    });
  }

  // Rechargement complet : les gardes de rôle relisent owner / organizer.
  window.location.assign(cErr ? `/get-started?key=${key}` : '/get-started');
  return { ok: true };
}

/**
 * « Mot de passe oublié » depuis la démo : on quitte proprement l'aperçu
 * (session démo effacée LOCALEMENT — jamais un signOut global, qui couperait
 * aussi les sessions de Paul sur ce compte démo) et la page de connexion
 * ramène sur /get-started, qui finit l'ouverture avec la clé.
 */
export async function leaveDemoForSignIn(key: string, email: string): Promise<void> {
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
  disablePreviewMode();
  clearDemoBypass();
  try { localStorage.setItem(PENDING_SIGNUP_KEY, key); } catch { /* ignore */ }
  const back = `/get-started?key=${key}`;
  const q = new URLSearchParams({ redirect: back });
  if (email) q.set('email', email);
  window.location.assign(`/auth?${q.toString()}`);
}

/** Retour à son compte déjà ouvert depuis la démo. */
export async function leaveDemoToAccount(): Promise<void> {
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
  disablePreviewMode();
  clearDemoBypass();
  window.location.assign(`/auth?${new URLSearchParams({ redirect: '/get-started' }).toString()}`);
}
