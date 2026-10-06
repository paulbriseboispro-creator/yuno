/**
 * Les sept recettes d'automatisation d'un compte Yuno CRM (billetterie
 * connectée) et leurs règles d'écran : délais proposés (miroir des choix
 * acceptés par crm_automation_save), modèle CRM qui leur donne leur e-mail,
 * libellés de délai, état d'une recette, consommation de Yunits.
 *
 * Le panier abandonné, le tarif qui monte et la table à proposer lisent le
 * checkout de Yuno : jamais déclenchés sur Shotgun. « A cliqué sans acheter »
 * lit un clic NOMINATIF dans un de nos e-mails, puis l'absence de billet
 * Shotgun à la même adresse : une visite venue d'ailleurs (Instagram, bio)
 * reste anonyme et n'y entre jamais. La bienvenue attend les
 * pages d'inscription (CRM_AUTOMATION_KINDS, src/lib/email/automations.ts).
 */
import type { CrmTemplateKind } from '@/crm/lib/emailTemplates';
import { interpolateVariables } from '@/lib/email/variables';

export const CRM_AUTO_KINDS = ['new_event', 'last_call', 'click_no_buy', 'post_event_thanks', 'post_event_missed', 'regular_lapse', 'win_back'] as const;
export type CrmAutoKind = (typeof CRM_AUTO_KINDS)[number];

export type AutoDirection = 'after' | 'before' | 'dormant';

export interface CrmAutoMeta {
  /** Modèle CRM qui donne son e-mail à la recette. */
  tpl: CrmTemplateKind;
  /** Délais proposés, en heures (email_automations.delay_hours). */
  delays: readonly number[];
  def: number;
  dir: AutoDirection;
  /** La recette ne part qu'après un scan à la porte. */
  needsScan?: boolean;
}

export const CRM_AUTO_META: Record<CrmAutoKind, CrmAutoMeta> = {
  new_event: { tpl: 'annonce', delays: [2, 6, 24], def: 6, dir: 'after' },
  last_call: { tpl: 'lastcall', delays: [12, 24, 48, 72], def: 24, dir: 'before' },
  // Miroir des délais acceptés par crm_automation_save (migration 20261009171000).
  click_no_buy: { tpl: 'relance', delays: [6, 12, 24, 48], def: 24, dir: 'after' },
  post_event_thanks: { tpl: 'merci', delays: [6, 12, 24, 48], def: 12, dir: 'after', needsScan: true },
  post_event_missed: { tpl: 'manque', delays: [12, 24, 48, 72], def: 24, dir: 'after', needsScan: true },
  regular_lapse: { tpl: 'manque', delays: [672, 1008, 1344], def: 1008, dir: 'dormant' },
  win_back: { tpl: 'manque', delays: [1080, 1440, 2160, 2880], def: 2160, dir: 'dormant' },
};

export function isCrmAutoKind(k: string): k is CrmAutoKind {
  return (CRM_AUTO_KINDS as readonly string[]).includes(k);
}

/** Valeur et unité lisibles d'un délai : « 6 h », « 2 j », « 6 sem. ». */
export function delayParts(kind: CrmAutoKind, hours: number): { n: number; unit: 'h' | 'd' | 'w' } {
  if (kind === 'regular_lapse') return { n: Math.round(hours / 168), unit: 'w' };
  if (hours >= 24 && hours % 24 === 0) return { n: hours / 24, unit: 'd' };
  return { n: hours, unit: 'h' };
}

export type CrmAutoState = 'on' | 'off' | 'ready' | 'none';

/**
 * on = allumée ; off = en pause (elle a déjà tourné) ; ready = réglée mais
 * jamais allumée ; none = pas encore créée (proposée comme modèle).
 */
export function autoState(r: { id: string | null; enabled: boolean; enabled_at: string | null }): CrmAutoState {
  if (!r.id) return 'none';
  if (r.enabled) return 'on';
  return r.enabled_at ? 'off' : 'ready';
}

/** Yunits consommés par semaine par les recettes allumées, au rythme des 4 dernières semaines. */
export function weeklyYunits(recipes: { enabled: boolean; week_avg: number }[], rate: number): number {
  return recipes.reduce((a, r) => a + (r.enabled ? Number(r.week_avg) || 0 : 0), 0) * rate;
}

/** Semaines d'automatisations que couvre le solde ; null sans consommation. */
export function runwayWeeks(balance: number, weekly: number): number | null {
  if (weekly <= 0) return null;
  return Math.max(0, balance) / weekly;
}

/**
 * La recette la plus rentable : ventes (ou, sans accès au chiffre
 * d'affaires, achats) par personne contactée, à partir de 30 personnes.
 */
export function bestPerPerson<T extends { kind: CrmAutoKind; contacted: number; purchases: number; revenue: number | null }>(
  recipes: T[], money: boolean,
): { r: T; v: number } | null {
  const rows = recipes
    .filter((r) => r.contacted >= 30)
    .map((r) => ({ r, v: (money ? Number(r.revenue ?? 0) : r.purchases) / r.contacted }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  return rows[0] ?? null;
}

/** Écart lisible entre deux périodes : null quand il n'y a rien à comparer. */
export function periodDelta(cur: number, prev: number): { stable: boolean; up: boolean; pct: number } | null {
  if (!prev) return null;
  const r = (cur - prev) / prev;
  const pct = Math.round(Math.abs(r) * 100);
  return { stable: pct === 0, up: r >= 0, pct };
}

/**
 * L'objet tel que la personne l'a reçu : ses variables remplies avec ce que
 * le fil connaît (prénom, nom), les autres avec leur repli.
 */
export function receivedSubject(subject: string, firstName: string | null, venueName = ''): string {
  return interpolateVariables(subject, {
    venueName, emailType: 'promotional', subject, baseUrl: '',
    recipient: { email: '', firstName },
  }).trim();
}

const parisParts = (ts: number) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const g = (k: string) => Number(parts.find((x) => x.type === k)?.value ?? 0);
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24, min: g('minute') };
};

/**
 * L'heure à laquelle un envoi automatique part vraiment : les automatisations
 * respectent les heures calmes (23 h → 9 h, heure de Paris) et partent à 9 h
 * quand leur moment tombe dedans.
 */
export function quietSendAt(iso: string): Date {
  const ts = new Date(iso).getTime();
  const p = parisParts(ts);
  if (p.h >= 9 && p.h < 23) return new Date(ts);
  const day = p.h >= 23 ? p.d + 1 : p.d;
  const guess = Date.UTC(p.y, p.m - 1, day, 9, 0);
  const w = parisParts(guess);
  const off = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - guess;
  return new Date(guess - off);
}
