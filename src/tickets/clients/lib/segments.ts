/**
 * Dessin et vocabulaire des segments de Yuno Tickets (copie de
 * src/crm/lib/segments.ts) : couleur, nom, règle en phrase, critères en
 * pastilles, et le catalogue des modèles (fenêtre « Choisissez vos segments »).
 * La règle elle-même vit en base (_tix_filter_sql) ; ici on ne fait que la
 * dire. Ce qui change par rapport au CRM : pas de famille « Ce qui fait
 * venir » (moteur d'analyse du CRM), pas de pages d'inscription, et la
 * provenance « Venu par Yuno ».
 */
import type { ClientFilterDef, Lifecycle } from '@/tickets/clients/data/clients';
import type { SegmentRow } from '@/tickets/clients/data/segments';
import { isAutoKey } from '@/tickets/clients/data/segments';
import { LIFECYCLE_COLOR } from '@/tickets/clients/lib/lifecycle';

type T = (k: string, v?: Record<string, string | number>) => string;

const CUSTOM_COLORS = ['var(--ya-ink)', 'var(--ya-sand-600)', 'var(--ya-sand-400)'];

export function segmentColor(seg: Pick<SegmentRow, 'key' | 'kind'>, customIndex: number): string {
  if (seg.kind === 'auto' && isAutoKey(seg.key)) return seg.key === 'none' ? 'var(--ya-sand-200)' : LIFECYCLE_COLOR[seg.key];
  return CUSTOM_COLORS[Math.max(0, customIndex) % CUSTOM_COLORS.length];
}

export function segmentName(seg: Pick<SegmentRow, 'key' | 'kind' | 'name'>, t: T): string {
  if (seg.kind === 'auto') return t(`ya.cli.seg.${seg.key}`);
  return seg.name || '—';
}

/** Modèles dont la croissance est une mauvaise nouvelle (habitués qui s'éloignent, inscrits absents…). */
const BAD_GROWTH = new Set([
  'loin', 'never_clicked', 'clicked_no_buy', 'winback', 'lapsed', 'dormant_year', 'gl_noshow', 'regulars_no_ticket',
]);

/** Un segment dont la croissance est une mauvaise nouvelle (endormis, habitués qui s'éloignent…). */
export function growthIsBad(seg: Pick<SegmentRow, 'key' | 'kind' | 'template'>): boolean {
  if (seg.kind === 'auto') return seg.key === 'end' || seg.key === 'none';
  return !!seg.template && BAD_GROWTH.has(templateBase(seg.template));
}

const days2txt = (d: number, t: T) => (d % 30 === 0 ? t('ya.seg.crit.moreThanMonths', { n: d / 30 }) : t('ya.seg.crit.moreThanDays', { n: d }));
const lessDays = (d: number, t: T) => (d % 30 === 0 ? t('ya.seg.crit.lessThanMonths', { n: d / 30 }) : t('ya.seg.crit.lessThanDays', { n: d }));
const range = (min: number | undefined, max: number | undefined, t: T) => (
  min !== undefined && max !== undefined ? t('ya.seg.crit.between', { a: min, b: max })
    : min !== undefined ? t('ya.seg.crit.atLeast', { n: min }) : t('ya.seg.crit.atMost', { n: max as number }));
const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
/** « saint denis » → « Saint Denis » : la clé d'une ville, lisible. */
export const areaLabel = (k: string) => k.replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

/** Les critères d'une définition, en pastilles « Clé · valeur ». */
export function criteria(def: ClientFilterDef, t: T): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  const f = def.f ?? {};
  if (def.seg && def.seg !== 'all') out.push({ k: t('ya.seg.crit.segment'), v: t(`ya.cli.seg.${def.seg}`) });
  if (f.ev?.length) out.push({ k: t('ya.cli.f.ev'), v: f.ev.includes('T') && f.ev.length === 1 ? t('ya.cli.f.ev.tonightShort') : t('ya.seg.crit.nights', { n: f.ev.length }) });
  if (f.last) out.push({ k: t('ya.cli.f.last'), v: t(`ya.cli.f.last.${f.last}`).toLowerCase() });
  if (f.last_gt_days) out.push({ k: t('ya.cli.f.last'), v: days2txt(f.last_gt_days, t) });
  if (num(f.last_lt_days) !== undefined) out.push({ k: t('ya.cli.f.last'), v: lessDays(num(f.last_lt_days) as number, t) });
  if (f.nb) out.push({ k: t('ya.cli.f.nb'), v: t(`ya.cli.f.nb.${f.nb}`).toLowerCase() });
  if (num(f.nb_min) !== undefined || num(f.nb_max) !== undefined) out.push({ k: t('ya.cli.f.nb'), v: range(num(f.nb_min), num(f.nb_max), t) });
  if (f.sp) out.push({ k: t('ya.cli.f.sp.title'), v: t(`ya.cli.f.sp.${f.sp}`).toLowerCase() });
  if (num(f.sp_min) !== undefined) out.push({ k: t('ya.cli.f.sp.title'), v: t('ya.seg.crit.eurMin', { v: num(f.sp_min) as number }) });
  if (num(f.basket_min) !== undefined) out.push({ k: t('ya.seg.crit.basket'), v: t('ya.seg.crit.eurMin', { v: num(f.basket_min) as number }) });
  if (num(f.paid_min) !== undefined) out.push({ k: t('ya.seg.crit.paid'), v: range(num(f.paid_min), undefined, t) });
  if (f.up) out.push({ k: t('ya.seg.crit.up'), v: t(`ya.seg.crit.up.${f.up}`) });
  if (num(f.age_min) !== undefined || num(f.age_max) !== undefined) out.push({ k: t('ya.seg.crit.age'), v: range(num(f.age_min), num(f.age_max), t) });
  if (f.gender) out.push({ k: t('ya.seg.crit.gender'), v: t(`ya.seg.crit.gender.${f.gender}`) });
  if (f.area?.length) out.push({ k: t('ya.seg.crit.area'), v: f.area.map(areaLabel).join(', ') });
  if (f.country?.length) out.push({ k: t('ya.seg.crit.country'), v: f.country.join(', ') });
  if (f.country_not) out.push({ k: t('ya.seg.crit.country'), v: t('ya.seg.crit.countryNot', { c: f.country_not }) });
  if (f.rc?.length) out.push({ k: t('ya.cli.f.rc'), v: f.rc.map((x) => t(`ya.cli.f.rc.${x}`)).join(', ') });
  if (f.ch) out.push({ k: t('ya.cli.f.rc'), v: t(`ya.seg.crit.ch.${f.ch}`) });
  if (f.src?.length) out.push({ k: t('ya.cli.f.src'), v: f.src.map((x) => t(`ya.cli.f.src.${x}`)).join(', ') });
  if (f.gl) out.push({ k: t('ya.gl.f'), v: t(`ya.gl.f.${f.gl}.short`) });
  if (f.tags?.length) out.push({ k: t('ya.seg.crit.tags'), v: f.tags.join(', ') });
  if (f.msg) out.push({ k: t('ya.seg.crit.msg'), v: t(`ya.seg.crit.msg.${f.msg}`) });
  if (num(f.click_lt_days) !== undefined) out.push({ k: t('ya.seg.crit.click'), v: lessDays(num(f.click_lt_days) as number, t) });
  if (f.emails?.length) out.push({ k: t('ya.seg.crit.fixed'), v: t('ya.seg.crit.fixedN', { n: f.emails.length }) });
  if (def.q) out.push({ k: t('ya.seg.crit.search'), v: `« ${def.q} »` });
  return out;
}

export function segmentRule(seg: Pick<SegmentRow, 'key' | 'kind' | 'description' | 'definition' | 'template'>, t: T,
  rules: { min: number; win: number; lapse: number }): string {
  if (seg.kind === 'auto') return t(`ya.cli.seg.${seg.key}.def`, { n: rules.min, m: seg.key === 'end' ? rules.lapse : rules.win });
  if (seg.template && SEGMENT_TEMPLATES.some((x) => x.id === seg.template)) return t(`ya.seg.tpl.${seg.template}.rule`);
  if (seg.description) return seg.description;
  const c = criteria(seg.definition ?? {}, t);
  return c.length ? c.map((x) => `${x.k} : ${x.v}`).join(' · ') : t('ya.seg.ruleAll');
}

// ── Catalogue des modèles ───────────────────────────────────────────────────

/** Les familles du catalogue, dans l'ordre de la fenêtre. */
export type SegGroupKey = 'loyalty' | 'next' | 'spend' | 'recency' | 'guest' | 'messages' | 'geo' | 'people' | 'channel' | 'source';
export const SEG_GROUPS: SegGroupKey[] = ['loyalty', 'next', 'spend', 'recency', 'guest', 'messages', 'geo', 'people', 'channel', 'source'];

export interface SegmentTemplate { id: string; def: ClientFilterDef; group: SegGroupKey }

/**
 * Les modèles FIXES (la définition ne dépend pas des données), ceux du CRM
 * moins « Ce qui fait venir » et « Pages d'inscription ». Ne jamais renommer
 * un identifiant : un segment déjà créé garde son `template`.
 */
export const SEGMENT_TEMPLATES: SegmentTemplate[] = [
  // Fidélité
  { id: 'freq_loyal', group: 'loyalty', def: { seg: 'all', f: { nb_min: 4 } } },
  { id: 'freq_regular', group: 'loyalty', def: { seg: 'all', f: { nb_min: 2, nb_max: 3 } } },
  { id: 'once', group: 'loyalty', def: { seg: 'all', f: { nb: '1', last_gt_days: 30 } } },
  { id: 'loin', group: 'loyalty', def: { seg: 'hab', f: { last_gt_days: 60 } } },
  { id: 'winback', group: 'loyalty', def: { seg: 'all', f: { nb_min: 3, last_gt_days: 180 } } },
  // Prochaine soirée
  { id: 'regulars_no_ticket', group: 'next', def: { seg: 'hab', f: { up: 'no' } } },
  { id: 'has_upcoming', group: 'next', def: { seg: 'all', f: { up: 'yes' } } },
  // Dépense (+ spend_top et basket_high, calculés sur les données)
  { id: 'buyers', group: 'spend', def: { seg: 'all', f: { paid_min: 1 } } },
  { id: 'vip', group: 'spend', def: { seg: 'all', f: { sp: '200+' } } },
  { id: 'small_spend', group: 'spend', def: { seg: 'all', f: { sp: '<50' } } },
  // Dernière venue
  { id: 'recent', group: 'recency', def: { seg: 'all', f: { last: '0-30' } } },
  { id: 'active_90', group: 'recency', def: { seg: 'all', f: { last_lt_days: 90 } } },
  { id: 'lapsed', group: 'recency', def: { seg: 'all', f: { last_gt_days: 90, last_lt_days: 365 } } },
  { id: 'dormant_year', group: 'recency', def: { seg: 'all', f: { last_gt_days: 365 } } },
  // Guest list
  { id: 'gl_loyal', group: 'guest', def: { seg: 'all', f: { gl: 'loyal' } } },
  { id: 'gl_conv', group: 'guest', def: { seg: 'all', f: { gl: 'conv' } } },
  { id: 'gl_noshow', group: 'guest', def: { seg: 'all', f: { gl: 'noshow' } } },
  { id: 'gl_only', group: 'guest', def: { seg: 'all', f: { gl: 'only' } } },
  // Messages
  { id: 'clicked_no_buy', group: 'messages', def: { seg: 'all', f: { msg: 'clicked_no_buy' } } },
  { id: 'clickers_90', group: 'messages', def: { seg: 'all', f: { click_lt_days: 90 } } },
  { id: 'never_clicked', group: 'messages', def: { seg: 'all', f: { msg: 'never_clicked' } } },
  { id: 'never_sent', group: 'messages', def: { seg: 'all', f: { msg: 'never_sent' } } },
  // Âge et genre
  { id: 'age_18_21', group: 'people', def: { seg: 'all', f: { age_min: 18, age_max: 21 } } },
  { id: 'age_22_25', group: 'people', def: { seg: 'all', f: { age_min: 22, age_max: 25 } } },
  { id: 'age_26_30', group: 'people', def: { seg: 'all', f: { age_min: 26, age_max: 30 } } },
  { id: 'age_31_plus', group: 'people', def: { seg: 'all', f: { age_min: 31 } } },
  { id: 'gender_female', group: 'people', def: { seg: 'all', f: { gender: 'female' } } },
  { id: 'gender_male', group: 'people', def: { seg: 'all', f: { gender: 'male' } } },
  // Canal
  { id: 'email_ok', group: 'channel', def: { seg: 'all', f: { rc: ['mail'] } } },
  { id: 'sms', group: 'channel', def: { seg: 'all', f: { rc: ['sms'] } } },
  { id: 'both', group: 'channel', def: { seg: 'all', f: { ch: 'both' } } },
  // Provenance
  { id: 'src_yuno', group: 'source', def: { seg: 'all', f: { src: ['yuno'] } } },
  { id: 'src_import', group: 'source', def: { seg: 'all', f: { src: ['import'] } } },
];

/**
 * Les modèles calculés par `tix_segment_catalog` sur les données de l'espace
 * (seuil de dépense, villes et pays les plus fréquents). Leur clé porte un
 * suffixe quand il y en a plusieurs (« geo_area:paris », « geo_country:es »).
 */
export const DYNAMIC_TEMPLATES: Record<string, SegGroupKey> = {
  spend_top: 'spend', basket_high: 'spend', geo_area: 'geo', geo_abroad: 'geo', geo_country: 'geo',
};

/**
 * Les modèles RECOMMANDÉS, dans l'ordre où la fenêtre les présente : ceux qui
 * servent le plus à vendre la prochaine soirée. Une recommandation ne
 * s'affiche qu'à partir de REC_MIN personnes (`recommendedKeys`).
 */
export const RECOMMENDED: readonly string[] = [
  'regulars_no_ticket', 'spend_top', 'once', 'loin', 'clicked_no_buy', 'lapsed', 'winback', 'gl_loyal',
];

export const REC_MIN = 10;

/** « geo_area:paris » → « geo_area ». */
export const templateBase = (key: string) => key.split(':')[0];

export function templateGroup(key: string): SegGroupKey | null {
  const base = templateBase(key);
  return SEGMENT_TEMPLATES.find((x) => x.id === base)?.group ?? DYNAMIC_TEMPLATES[base] ?? null;
}

/** Ce que le catalogue envoie au serveur : les modèles fixes. */
export const CATALOG_ITEMS = SEGMENT_TEMPLATES.map((x) => ({ key: x.id, def: x.def }));

/** Lien vers la liste des clients d'un segment. */
export function clientsHrefFor(seg: Pick<SegmentRow, 'key' | 'kind'>, base: string): string {
  return seg.kind === 'auto' ? `${base}?s=${seg.key as Lifecycle}` : `${base}?seg=${seg.key}`;
}
