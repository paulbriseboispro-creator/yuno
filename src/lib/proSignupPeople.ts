/**
 * Page super admin « Inscriptions pro » : une carte par PERSONNE (migration
 * 20261104220000, RPC admin_pro_signups). Le regroupement des parcours se fait
 * en base ; ce module ne fait que lire : numéros au format international (même
 * règle que la fiche du Cockpit), provenance en clair, dernière alerte.
 */
import { phoneE164, phonePretty, sourceParts, type SignupOrigin } from '../../supabase/functions/_shared/pro-signup-fiche.ts';

export type { SignupOrigin };

export type SignupOutcome = 'account' | 'deleted' | 'request' | 'invited' | 'blocked';

export interface SignupJourney {
  id: string; at: string; updated_at: string | null; kind: string | null; product: string | null;
  org_name: string | null; source: string | null; utm_source: string | null; referrer_host: string | null;
  device: string | null; step: string | null; has_email: boolean; account_created_at: string | null;
  account: boolean; deleted: boolean; invited: boolean;
}

export interface SignupAlert {
  kind: string; status: string; at: string; sent_at: string | null;
  cockpit: boolean; push: boolean; telegram: boolean; email: boolean;
}

export interface SignupPerson {
  key: string; ids: string[]; outcome: SignupOutcome; furthest_step: string | null;
  first_at: string; last_at: string;
  first_name: string | null; last_name: string | null; email: string | null; emails: string[];
  phones: string[]; org_name: string | null; kind: string | null; product: string | null;
  city: string | null; country: string | null; lang: string | null;
  size_band: string | null; frequency: string | null; current_tool: string | null; next_night: string | null;
  origin: SignupOrigin | null;
  invited: boolean; invite: { source: string | null; offer: string | null; kind: string | null } | null;
  contacted_at: string | null; admin_notes: string | null;
  account: {
    user_id: string; venue_id: string | null; created_at: string | null; console_opened_at: string | null;
    events: number; payments: boolean; live: boolean;
  } | null;
  deleted_accounts: number; retries_after_account: number;
  journeys: SignupJourney[]; alerts: SignupAlert[];
}

export interface SignupPhone { e164: string; pretty: string; wa: string }

/** « +33 7 56 38 87 60 » : international, groupé pour se lire. */
export function intlPretty(e164: string): string {
  if (e164.startsWith('+33') && e164.length === 12) {
    return `+33 ${e164[3]} ${e164.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ')}`;
  }
  return phonePretty(e164) ?? e164;
}

/** Les numéros d'une personne, au format international, sans doublon : « 0756388760 »
 *  et « 756388760 » sont le même (9 derniers chiffres, comme le regroupement SQL). */
export function personPhones(raws: readonly (string | null | undefined)[], country?: string | null): SignupPhone[] {
  const seen = new Set<string>();
  const out: SignupPhone[] = [];
  for (const raw of raws) {
    const e164 = phoneE164(raw, country ?? 'FR');
    if (!e164) continue;
    const key = e164.replace(/\D/g, '').slice(-9);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ e164, pretty: intlPretty(e164), wa: e164.slice(1) });
  }
  return out;
}

export const KNOWN_DEVICES = new Set(['mobile', 'desktop', 'tablet']);

const KNOWN_PAGES = new Set([
  'landing', 'start', 'start_crm', 'crm', 'asso', 'app_form', 'yuno_links', 'landing_contact',
  'demo_preview', 'crm_invite',
]);

/** « ChatGPT → la landing » dans la langue de l'écran. `t` lit les clés
 *  `adm.signups.src.*` ; un canal est un nom propre, sauf l'app Yuno. */
export function sourceText(origin: SignupOrigin | null | undefined, t: (key: string) => string): string {
  const { channel, page } = sourceParts(origin);
  const c = channel === 'yuno_app' ? t('adm.signups.src.yunoApp') : channel;
  const p = page ? (KNOWN_PAGES.has(page) ? t(`adm.signups.src.${page}`) : page) : null;
  if (c && p) return `${c} → ${p}`;
  return c ?? p ?? t('adm.signups.src.unknown');
}

/** Les provenances regroupées par libellé : deux origines brutes qui se lisent
 *  pareil (« landing » sans référent, « landing-fr ») font une seule ligne. */
export function sourceRows(
  rows: readonly { origin: SignupOrigin | null; started: number; created: number }[],
  t: (key: string) => string,
): { label: string; started: number; created: number }[] {
  const byLabel = new Map<string, { label: string; started: number; created: number }>();
  for (const r of rows) {
    const label = sourceText(r.origin, t);
    const cur = byLabel.get(label) ?? { label, started: 0, created: 0 };
    cur.started += r.started;
    cur.created += r.created;
    byLabel.set(label, cur);
  }
  return [...byLabel.values()].sort((a, b) => b.started - a.started || b.created - a.created);
}

/** Ce qui est arrivé à un parcours, en une clé de libellé. */
export function journeyResult(j: Pick<SignupJourney, 'account' | 'deleted' | 'step' | 'account_created_at'>): {
  key: 'account' | 'deleted' | 'request' | 'stopped'; step: string;
} {
  if (j.account) return { key: 'account', step: 'created' };
  if (j.deleted) return { key: 'deleted', step: 'created' };
  if (j.step === 'lead') return { key: 'request', step: 'lead' };
  return { key: 'stopped', step: j.step ?? 'opened' };
}

/** Par où l'alerte est arrivée chez Paul : Cockpit (fiche), téléphone (push),
 *  Telegram, e-mail de secours. */
export function alertChannels(a: SignupAlert): ('cockpit' | 'push' | 'telegram' | 'email')[] {
  return (['cockpit', 'push', 'telegram', 'email'] as const).filter((k) => a[k]);
}
