/**
 * Dessin et vocabulaire des segments : couleur, nom, règle en phrase, critères
 * en pastilles, modèles de la fenêtre « Nouveau segment ». La règle elle-même
 * vit en base (_crm_filter_sql) ; ici on ne fait que la dire.
 */
import type { ClientFilterDef, Lifecycle } from '@/crm/data/clients';
import type { SegmentRow } from '@/crm/data/segments';
import { isAutoKey } from '@/crm/data/segments';
import { LIFECYCLE_COLOR } from './lifecycle';

type T = (k: string, v?: Record<string, string | number>) => string;

const CUSTOM_COLORS = ['var(--ink)', 'var(--sand-600)', 'var(--sand-400)'];

export function segmentColor(seg: Pick<SegmentRow, 'key' | 'kind'>, customIndex: number): string {
  if (seg.kind === 'auto' && isAutoKey(seg.key)) return seg.key === 'none' ? 'var(--sand-200)' : LIFECYCLE_COLOR[seg.key];
  return CUSTOM_COLORS[Math.max(0, customIndex) % CUSTOM_COLORS.length];
}

export function segmentName(seg: Pick<SegmentRow, 'key' | 'kind' | 'name'>, t: T): string {
  if (seg.kind === 'auto') return t(`yc.cli.seg.${seg.key}`);
  return seg.name || '—';
}

/** Un segment dont la croissance est une mauvaise nouvelle (endormis, habitués qui s'éloignent…). */
export function growthIsBad(seg: Pick<SegmentRow, 'key' | 'kind' | 'template'>): boolean {
  if (seg.kind === 'auto') return seg.key === 'end' || seg.key === 'none';
  return seg.template === 'loin' || seg.template === 'never_clicked' || seg.template === 'clicked_no_buy';
}

const days2txt = (d: number, t: T) => (d % 30 === 0 ? t('yc.seg.crit.moreThanMonths', { n: d / 30 }) : t('yc.seg.crit.moreThanDays', { n: d }));

/** Les critères d'une définition, en pastilles « Clé · valeur ». */
export function criteria(def: ClientFilterDef, t: T): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  const f = def.f ?? {};
  if (def.seg && def.seg !== 'all') out.push({ k: t('yc.seg.crit.segment'), v: t(`yc.cli.seg.${def.seg}`) });
  if (f.ev?.length) out.push({ k: t('yc.cli.f.ev'), v: f.ev.includes('T') && f.ev.length === 1 ? t('yc.cli.f.ev.tonightShort') : t('yc.seg.crit.nights', { n: f.ev.length }) });
  if (f.last) out.push({ k: t('yc.cli.f.last'), v: t(`yc.cli.f.last.${f.last}`).toLowerCase() });
  if (f.last_gt_days) out.push({ k: t('yc.cli.f.last'), v: days2txt(f.last_gt_days, t) });
  if (f.nb) out.push({ k: t('yc.cli.f.nb'), v: t(`yc.cli.f.nb.${f.nb}`).toLowerCase() });
  if (f.sp) out.push({ k: t('yc.cli.f.sp.title'), v: t(`yc.cli.f.sp.${f.sp}`).toLowerCase() });
  if (f.rc?.length) out.push({ k: t('yc.cli.f.rc'), v: f.rc.map((x) => t(`yc.cli.f.rc.${x}`)).join(', ') });
  if (f.src?.length) out.push({ k: t('yc.cli.f.src'), v: f.src.map((x) => t(`yc.cli.f.src.${x}`)).join(', ') });
  if (f.tags?.length) out.push({ k: t('yc.seg.crit.tags'), v: f.tags.join(', ') });
  if (f.msg) out.push({ k: t('yc.seg.crit.msg'), v: t(`yc.seg.crit.msg.${f.msg}`) });
  if (f.emails?.length) out.push({ k: t('yc.seg.crit.fixed'), v: t('yc.seg.crit.fixedN', { n: f.emails.length }) });
  if (def.q) out.push({ k: t('yc.seg.crit.search'), v: `« ${def.q} »` });
  return out;
}

export function segmentRule(seg: Pick<SegmentRow, 'key' | 'kind' | 'description' | 'definition' | 'template'>, t: T,
  rules: { min: number; win: number; lapse: number }): string {
  if (seg.kind === 'auto') return t(`yc.cli.seg.${seg.key}.def`, { n: rules.min, m: seg.key === 'end' ? rules.lapse : rules.win });
  if (seg.template && SEGMENT_TEMPLATES.some((x) => x.id === seg.template)) return t(`yc.seg.tpl.${seg.template}.rule`);
  if (seg.description) return seg.description;
  const c = criteria(seg.definition ?? {}, t);
  return c.length ? c.map((x) => `${x.k} : ${x.v}`).join(' · ') : t('yc.seg.ruleAll');
}

export interface SegmentTemplate { id: string; def: ClientFilterDef | null; soon?: boolean }

/** Les modèles de « Nouveau segment ». `page` = provenance « Pages d'inscription » (`_crm_people_build`). */
export const SEGMENT_TEMPLATES: SegmentTemplate[] = [
  { id: 'vip', def: { seg: 'all', f: { sp: '200+' } } },
  { id: 'loin', def: { seg: 'hab', f: { last_gt_days: 60 } } },
  { id: 'once', def: { seg: 'all', f: { nb: '1', last_gt_days: 30 } } },
  { id: 'recent', def: { seg: 'all', f: { last: '0-30' } } },
  { id: 'sms', def: { seg: 'all', f: { rc: ['sms'] } } },
  { id: 'never_clicked', def: { seg: 'all', f: { msg: 'never_clicked' } } },
  { id: 'clicked_no_buy', def: { seg: 'all', f: { msg: 'clicked_no_buy' } } },
  { id: 'small_spend', def: { seg: 'all', f: { sp: '<50' } } },
  { id: 'page', def: { seg: 'all', f: { src: ['page'] } } },
];

/** Lien vers la liste des clients d'un segment. */
export function clientsHrefFor(seg: Pick<SegmentRow, 'key' | 'kind'>, base: string): string {
  return seg.kind === 'auto' ? `${base}?s=${seg.key as Lifecycle}` : `${base}?seg=${seg.key}`;
}
