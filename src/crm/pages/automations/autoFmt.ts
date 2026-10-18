/**
 * Formats de l'écran Automatisations : tracés d'icônes du prototype, mots
 * des délais (puce, lien du schéma, phrase d'envoi), « il y a… », écart avec
 * la période d'avant.
 */
import type { useCrmT } from '@/crm/i18n';
import { CRM_AUTO_META, delayParts, periodDelta, type CrmAutoKind } from '@/crm/lib/automations';
import type { Automations } from '@/crm/data/automations';

type T = ReturnType<typeof useCrmT>;

export const AU_IC = {
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2',
  trend: 'm22 17-8.5-8.5-5 5L2 7M16 17h6v-6',
  repeat: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  back: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  sms: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chevron: 'm6 9 6 6 6-6',
  x: 'M18 6 6 18M6 6l12 12',
} as const;

export const KIND_IC: Record<CrmAutoKind, string> = {
  new_event: AU_IC.cal,
  last_call: AU_IC.clock,
  click_no_buy: AU_IC.bag,
  post_event_thanks: AU_IC.moon,
  post_event_missed: AU_IC.ticket,
  first_return: AU_IC.back,
  regular_lapse: AU_IC.trend,
  win_back: AU_IC.repeat,
};

/** « 6 h », « 2 jours », « 6 semaines ». */
export function delayWord(T: T, kind: CrmAutoKind, hours: number): string {
  const { n, unit } = delayParts(kind, hours);
  if (unit === 'h') return T.t('yc.au.d.h', { n });
  return T.tp(unit === 'd' ? 'yc.au.d.d' : 'yc.au.d.w', n, { n });
}

const effective = (kind: CrmAutoKind, hours: number | null | undefined) => hours ?? CRM_AUTO_META[kind].def;

/** Puce du choix de délai : « 6 h après », « 24 h avant », « Après 6 semaines ». */
export function chipLabel(T: T, kind: CrmAutoKind, hours: number): string {
  return T.t(`yc.au.chip.${CRM_AUTO_META[kind].dir}`, { d: delayWord(T, kind, hours) });
}

/** Libellé du lien entre le déclencheur et l'e-mail : « +6 h », « 24 h avant ». */
export function linkLabel(T: T, kind: CrmAutoKind, hours: number | null | undefined): string {
  return T.t(`yc.au.link.${CRM_AUTO_META[kind].dir}`, { d: delayWord(T, kind, effective(kind, hours)) });
}

/** Phrase d'envoi : « Envoi : 6 h après la publication de la soirée ». */
export function whenLabel(T: T, kind: CrmAutoKind, hours: number | null | undefined): string {
  return T.t(`yc.au.r.${kind}.when`, { d: delayWord(T, kind, effective(kind, hours)) });
}

/** « à l'instant », « il y a 12 min », « il y a 3 h », « il y a 2 jours ». */
export function agoLabel(T: T, iso: string, now: number = Date.now()): string {
  const min = (now - new Date(iso).getTime()) / 60000;
  if (min < 1) return T.t('yc.au.ago.now');
  if (min < 60) return T.t('yc.au.ago.min', { n: Math.round(min) });
  if (min < 60 * 24) return T.t('yc.au.ago.h', { n: Math.round(min / 60) });
  return T.tp('yc.au.ago.d', Math.round(min / 1440));
}

const G = 'var(--green-700)';
const R = 'var(--red-600)';
const N = 'var(--sand-500)';

/** Écart avec la période d'avant : texte et couleur. */
export function deltaText(T: T, cur: number, prev: number): [string, string] {
  const d = periodDelta(cur, prev);
  if (!d) return [T.t('yc.au.delta.first'), N];
  if (d.stable) return [T.t('yc.au.delta.stable'), N];
  return [`${d.up ? '▲ +' : '▼ −'}${T.pct(d.pct)} ${T.t('yc.au.delta.vs')}`, d.up ? G : R];
}

/** Écart en points d'un taux (0-1). */
export function deltaPts(T: T, cur: number, prev: number, hasPrev: boolean): [string, string] {
  if (!hasPrev) return [T.t('yc.au.delta.first'), N];
  const pts = (cur - prev) * 100;
  if (Math.abs(pts) < 0.05) return [T.t('yc.au.delta.stable'), N];
  return [`${pts >= 0 ? '▲ +' : '▼ −'}${T.t('yc.au.pt', { n: T.n1(Math.abs(pts)) })} ${T.t('yc.au.delta.vs')}`, pts >= 0 ? G : R];
}

/** État de la fenêtre de création / réglage d'une recette. */
export interface ModalState {
  mode: 'new' | 'edit' | 'reco'; kind: CrmAutoKind; step: 1 | 2 | 3; delay: number; subject: string;
  /** « 1re soirée » : le SMS qui suit l'e-mail (texte pré-rempli à la 1re ouverture). */
  sms?: { on: boolean; body: string; delay: number };
}

/** Ouvre la fenêtre sur une recette, avec ses réglages actuels. */
export function startModal(d: Automations, mode: ModalState['mode'], kind: CrmAutoKind, step: ModalState['step'], smsDefault = ''): ModalState {
  const r = d.recipes.find((x) => x.kind === kind);
  const base: ModalState = { mode, kind, step, delay: r?.delay_hours ?? CRM_AUTO_META[kind].def, subject: r?.subject ?? '' };
  if (kind !== 'first_return') return base;
  // Une étape jamais réglée s'ouvre allumée, avec un texte à relire.
  const fresh = !r?.sms?.body;
  return { ...base, sms: { on: fresh ? true : !!r?.sms?.enabled, body: r?.sms?.body ?? smsDefault, delay: r?.sms?.delay_days ?? 5 } };
}
