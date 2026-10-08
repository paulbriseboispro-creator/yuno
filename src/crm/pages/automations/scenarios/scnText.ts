/**
 * Les mots des Scénarios : familles et feuilles de l'éditeur de conditions,
 * résumés d'un déclencheur, d'une étape, d'une condition, d'une erreur.
 * Textes : clés `yc.scn.*` (module src/i18n/locales/crm/modules/scenarios.ts) ;
 * les familles d'hypothèses gardent leurs mots de l'analyse (`yc.why.fam.*`).
 */
import { FAMILIES } from '@/crm/lib/analysis';
import {
  CHANCE_LABELS, CHANNEL_CODES, COND_LEAVES, TARGET_AUDIENCES, isCondGroup, type CondContext, type CondFamily, type CondLeaf, type CondNode,
} from '@/crm/lib/scenarioConditions';
import type { ScenarioGraph } from '@/crm/lib/scenarioGraph';
import type { ScnIssue } from '@/crm/data/scenarios';
import type { useCrmT } from '@/crm/i18n';

export type T = ReturnType<typeof useCrmT>;

/** Avertissements (n'empêchent pas de publier). */
export const WARN_CODES = new Set(['family_not_confirmed', 'chance_unavailable']);

/** Les familles de l'éditeur, dans l'ordre (plan § 3.4). */
export const LEAF_FAMILIES: { family: CondFamily; keys: string[] }[] = [
  { family: 'profile', keys: ['age_min', 'age_max', 'gender', 'area', 'country', 'country_not', 'dist_min', 'dist_max', 'pass', 'src', 'tags', 'segment'] },
  { family: 'nights', keys: ['seg', 'ev', 'last', 'last_gt_days', 'last_lt_days', 'nb', 'nb_min', 'nb_max', 'sp', 'sp_min', 'basket_min', 'paid_min', 'up', 'sc_bought', 'sc_entered'] },
  { family: 'why', keys: ['hyp', 'sc_family', 'artist', 'genre', 'fmt', 'series', 'buy', 'grp', 'ntgt'] },
  { family: 'chance', keys: ['sc_chance'] },
  { family: 'messages', keys: ['msg', 'click_lt_days', 'sc_opened', 'sc_clicked', 'sc_sms_delivered', 'sc_sms_clicked'] },
  { family: 'guestlist', keys: ['gl', 'glev'] },
  { family: 'channel', keys: ['rc', 'ch', 'arr'] },
];

/** Feuille offerte dans ce contexte ? (une feuille d'inscription n'existe pas dans le filtre d'entrée). */
export function leafAllowed(k: string, ctx: CondContext): boolean {
  const d = COND_LEAVES[k];
  if (!d) return false;
  return !(ctx === 'entry' && d.scenario && !d.entry);
}

/** Les valeurs d'une feuille à liste (enum / set). */
export function leafValues(k: string): readonly string[] {
  const d = COND_LEAVES[k];
  if (!d) return [];
  if (d.spec.t === 'enum' || d.spec.t === 'set') return d.spec.of;
  return [];
}

export function valueLabel(T: T, k: string, v: string): string {
  if (k === 'hyp' || k === 'sc_family') return T.t(`yc.why.fam.${v}`);
  if (k === 'arr') return T.t(`yc.scn.v.arr.${v}`);
  return T.t(`yc.scn.v.${k}.${v}`);
}

/** La valeur par défaut d'une feuille ajoutée (lisible tout de suite, jamais vide). */
export function defaultLeaf(k: string, o: { firstEmail?: string | null; firstSms?: string | null; hasEvent: boolean }): CondLeaf {
  const d = COND_LEAVES[k];
  const spec = d?.spec;
  switch (spec?.t) {
    case 'enum': return { k, v: spec.of[0] };
    case 'set': return { k, v: [spec.of[0]] };
    case 'int': return { k, v: k.startsWith('age') ? (k === 'age_min' ? 18 : 30) : k.startsWith('dist') ? 30 : k.startsWith('last') || k === 'click_lt_days' ? 60 : 2 };
    case 'money': return { k, v: 50 };
    case 'bool': return { k, v: k === 'sc_bought' ? false : true };
    case 'strings': return { k, v: [] };
    case 'pattern': return { k, v: 'FR' };
    case 'patterns': return { k, v: k === 'country' ? ['FR'] : [] };
    case 'uuid': return { k, v: '' };
    case 'events': return { k, v: [o.hasEvent ? '$event' : 'T'] };
    case 'ntgt': return { k, v: { e: o.hasEvent ? '$event' : '', a: TARGET_AUDIENCES[0] } };
    case 'node': return { k, v: (k === 'sc_sms_delivered' ? o.firstSms : o.firstEmail) ?? '' };
    default: return { k, v: null };
  }
}

export const CHANNELS = CHANNEL_CODES;
export const AUDIENCES = TARGET_AUDIENCES;
export const CHANCES = CHANCE_LABELS;
export const FAMILY_LIST = FAMILIES;

/** Résumé court d'une feuille (« Venu 1 fois », « A ouvert : E-mail 1 »). */
export function leafSummary(T: T, l: CondLeaf, ctx: { nodeName: (id: string) => string; eventName: (id: string) => string; segmentName: (id: string) => string }): string {
  const { t, n } = T;
  const label = t(`yc.scn.leaf.${l.k}`);
  const v = l.v;
  const d = COND_LEAVES[l.k];
  if (!d) return t('yc.scn.leaf.unknown');
  const list = (xs: unknown) => (Array.isArray(xs) ? xs : []).map(String);
  switch (d.spec.t) {
    case 'enum': return `${label} : ${typeof v === 'string' ? valueLabel(T, l.k, v) : '—'}`;
    case 'set': return `${label} : ${list(v).map((x) => valueLabel(T, l.k, x)).join(', ') || '—'}`;
    case 'int': return `${label} : ${typeof v === 'number' ? n(v) : '—'}`;
    case 'money': return `${label} : ${typeof v === 'number' ? T.eur(v) : '—'}`;
    case 'bool': return `${label} : ${t(v === true ? 'yc.scn.yes' : 'yc.scn.no')}`;
    case 'strings':
    case 'patterns': return `${label} : ${list(v).map((x) => x.replace(/^(id|slug|name):/, '')).join(', ') || '—'}`;
    case 'pattern': return `${label} : ${typeof v === 'string' ? v.toUpperCase() : '—'}`;
    case 'uuid': return `${label} : ${typeof v === 'string' && v ? ctx.segmentName(v) : '—'}`;
    case 'events': return `${label} : ${list(v).map((x) => (x === '$event' ? t('yc.scn.ev.scenarioInline') : x === 'T' ? t('yc.scn.ev.tonightInline') : ctx.eventName(x))).join(', ') || '—'}`;
    case 'ntgt': {
      const o = (v && typeof v === 'object' ? v : {}) as { e?: string; a?: string };
      return `${label} : ${o.a ? t(`yc.scn.v.ntgt.${o.a}`) : '—'} · ${o.e === '$event' ? t('yc.scn.ev.scenarioInline') : o.e ? ctx.eventName(o.e) : '—'}`;
    }
    case 'node': return `${label} : ${typeof v === 'string' && v ? ctx.nodeName(v) : '—'}`;
    default: return `${label} : ${t('yc.scn.soon')}`;
  }
}

/** Résumé d'une condition entière, en une ligne (« Venu 1 fois et Pass : non »). */
export function condSummary(T: T, tree: unknown, ctx: Parameters<typeof leafSummary>[2], depth = 0): string {
  if (!tree) return T.t('yc.scn.cond.none');
  if (!isCondGroup(tree)) return leafSummary(T, tree as CondLeaf, ctx);
  const items = Array.isArray(tree.items) ? tree.items : [];
  if (!items.length) return T.t('yc.scn.cond.empty');
  const joiner = ` ${T.t(tree.op === 'or' ? 'yc.scn.cond.or' : 'yc.scn.cond.and')} `;
  // Parenthèses seulement quand un sous-groupe en a besoin (plusieurs conditions).
  const parts = items.map((it: CondNode) => {
    if (!isCondGroup(it)) return leafSummary(T, it as CondLeaf, ctx);
    const inner = condSummary(T, it, ctx, depth + 1);
    return (Array.isArray(it.items) ? it.items.length : 0) > 1 && !it.not ? `(${inner})` : inner;
  });
  const s = parts.join(joiner);
  return tree.not ? `${T.t('yc.scn.cond.notPrefix')} ${items.length > 1 ? `(${s})` : s}` : s;
}

/** Le déclencheur en une phrase. */
export function triggerSummary(T: T, g: ScenarioGraph, names: { segment: (id: string) => string; page: (id: string) => string }): string {
  const { t, tp } = T;
  const tr = g.trigger ?? { type: '' };
  const num = (x: unknown) => (typeof x === 'number' ? x : 0);
  switch (tr.type) {
    case 'before_event': return tp('yc.scn.trg.before_event.sum', num(tr.days)) + (typeof tr.series === 'string' && tr.series ? ` · ${t('yc.scn.trg.series', { s: tr.series })}` : '');
    case 'after_event': return `${tp('yc.scn.trg.after_event.sum', num(tr.hours))} · ${t(`yc.scn.v.who.${String(tr.who ?? 'all')}`)}`;
    case 'absence': return tp('yc.scn.trg.absence.sum', num(tr.days));
    case 'click_no_buy': return tp('yc.scn.trg.click_no_buy.sum', num(tr.hours));
    case 'ticket_bought': return t(tr.first ? 'yc.scn.trg.ticket_bought.sumFirst' : 'yc.scn.trg.ticket_bought.sum');
    case 'segment_joined':
    case 'manual_segment': return t(`yc.scn.trg.${tr.type}.sum`, { name: typeof tr.segment_id === 'string' && tr.segment_id ? names.segment(tr.segment_id) : '—' });
    case 'signup_confirmed': return t('yc.scn.trg.signup_confirmed.sum', { name: typeof tr.page_id === 'string' && tr.page_id ? names.page(tr.page_id) : '—' });
    case 'event_published':
    case 'chance_high': return t(`yc.scn.trg.${tr.type}.sum`);
    case 'cart_abandoned':
    case 'shotgun_visit': return t(`yc.scn.trg.${tr.type}`);
    default: return t('yc.scn.trg.none');
  }
}

/** Résumé d'une étape (la ligne sous son titre dans le flux). */
export function nodeSummary(T: T, node: Record<string, unknown> & { type: string }, ctx: Parameters<typeof leafSummary>[2] & { template: (id: string) => string }): string {
  const { t, tp } = T;
  const evMode = (e: unknown, id: unknown) => (e === 'fixed' ? ctx.eventName(String(id ?? '')) : t(`yc.scn.evmode.${String(e ?? 'scenario')}.short`));
  switch (node.type) {
    case 'wait':
      if (node.mode === 'duration') return waitDuration(T, Number(node.hours ?? 0));
      if (node.mode === 'until_event') {
        if (typeof node.hours === 'number') return t('yc.scn.wait.untilEventH', { when: relHours(T, node.hours), anchor: t(`yc.scn.anchor.${String(node.anchor ?? 'start')}`) });
        return t('yc.scn.wait.untilEventD', { when: relDays(T, Number(node.days ?? 0)), at: String(node.at ?? ''), anchor: t(`yc.scn.anchor.${String(node.anchor ?? 'start')}`) });
      }
      return t('yc.scn.wait.untilCond', { cond: condSummary(T, node.cond, ctx), max: waitDuration(T, Number(node.max_hours ?? 0)) });
    case 'branch': return condSummary(T, node.cond, ctx);
    case 'split': return (Array.isArray(node.paths) ? node.paths : []).map((p, i) => `${String.fromCharCode(65 + i)} ${(p as { pct?: number }).pct ?? 0} %`).join(' · ');
    case 'email': return `${typeof node.template_id === 'string' && node.template_id ? ctx.template(node.template_id) : t('yc.scn.email.noTemplate')} · ${evMode(node.event, node.event_id)}`;
    case 'sms': return typeof node.body === 'string' && node.body.trim() ? node.body.trim() : t('yc.scn.sms.empty');
    case 'tag': return t(node.op === 'remove' ? 'yc.scn.tag.removeSum' : 'yc.scn.tag.addSum', { tag: String(node.tag ?? '') || '—' });
    case 'notify': return String(node.label ?? '') || t('yc.scn.notify.empty');
    case 'instagram_dm': return t('yc.scn.soon');
    case 'end': return t('yc.scn.end.sum');
    default: return tp('yc.scn.unknownNode', 1);
  }
}

export function waitDuration(T: T, hours: number): string {
  if (hours > 0 && hours % 24 === 0) return T.tp('yc.scn.days', hours / 24);
  return T.tp('yc.scn.hours', hours);
}

function relHours(T: T, h: number): string {
  if (h === 0) return T.t('yc.scn.rel.at');
  return T.t(h < 0 ? 'yc.scn.rel.before' : 'yc.scn.rel.after', { d: waitDuration(T, Math.abs(h)) });
}

function relDays(T: T, d: number): string {
  if (d === 0) return T.t('yc.scn.rel.sameDay');
  return T.t(d < 0 ? 'yc.scn.rel.dBefore' : 'yc.scn.rel.dAfter', { n: Math.abs(d) });
}

/** Une erreur de validation en phrase (le nœud fautif est nommé par l'écran). */
export function errorText(T: T, e: ScnIssue): string {
  const code = e.code;
  const field = e.field ?? '';
  // Un paramètre du déclencheur : on nomme le champ.
  if (code === 'bad_param' && field.startsWith('trigger.')) return T.t('yc.scn.err.trigger_param', { f: T.t(`yc.scn.f.${field.slice(8)}`) });
  if (code === 'bad_param') return T.t('yc.scn.err.bad_param', { f: T.t(`yc.scn.f.${field.split('.')[0] || 'value'}`) });
  if (code === 'no_event') return T.t(field.startsWith('entry') || field === 'goal' ? 'yc.scn.err.no_event_scenario' : 'yc.scn.err.no_event');
  if (code === 'family_not_confirmed') return T.t('yc.scn.warn.family_not_confirmed', { f: T.t(`yc.why.fam.${field.split(':')[1] ?? ''}`) });
  return T.t(`yc.scn.err.${code}`);
}
