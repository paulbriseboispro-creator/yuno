// Inscription pro en libre-service — source de vérité côté app.
//
// Le funnel vit sur la landing (landing.yunoapp.eu/start, repo Yuno-landing) :
// elle crée le compte sur CE projet Supabase, appelle complete_pro_signup()
// (migration 20260924120000), puis passe la session à /auth/handoff, qui
// atterrit sur /get-started (page GetStarted). Tout lien « créer un compte
// pro » de l'app pointe sur la landing via proSignupUrl() — jamais sur /auth,
// qui crée un compte CLIENT.
import type { Language } from '@/i18n/data';

export const PRO_SIGNUP_ORIGIN = 'https://landing.yunoapp.eu';

export type ProSignupKind = 'club' | 'organizer';

/** Lien vers le funnel d'inscription pro, dans la langue de la personne. */
export function proSignupUrl(
  language: Language,
  opts: { role?: ProSignupKind; source?: string } = {},
): string {
  const path = language === 'fr' ? '/fr/start' : language === 'es' ? '/es/start' : '/start';
  const q = new URLSearchParams();
  if (opts.role) q.set('role', opts.role);
  q.set('utm_source', 'yuno_app');
  if (opts.source) q.set('utm_medium', opts.source);
  return `${PRO_SIGNUP_ORIGIN}${path}?${q.toString()}`;
}

/** Ce que la personne a raconté sur la landing (RPC open_my_pro_signup). */
export interface MyProSignup {
  kind: ProSignupKind | 'promoter' | 'other' | null;
  first_name: string | null;
  org_name: string | null;
  city: string | null;
  size_band: string | null;
  frequency: string | null;
  pillars: string[] | null;
  current_tool: string | null;
  next_night: 'week' | 'month' | 'later' | 'unknown' | null;
  lang: string | null;
  venue_id: string | null;
}

/** Billetteries dont on sait importer la base clients (export CSV). */
export const KNOWN_TOOLS: Record<string, string> = {
  shotgun: 'Shotgun',
  dice: 'DICE',
  weezevent: 'Weezevent',
  eventbrite: 'Eventbrite',
  xceed: 'Xceed',
  fever: 'Fever',
};

/** Clé du parcours déposée par la landing quand la personne doit d'abord
 *  confirmer son email ou se connecter (compte existant). */
export const PENDING_SIGNUP_KEY = 'yuno_pending_pro_signup';

export function isValidSignupKey(k: string | null | undefined): k is string {
  return !!k && /^[A-Za-z0-9_-]{16,64}$/.test(k);
}
