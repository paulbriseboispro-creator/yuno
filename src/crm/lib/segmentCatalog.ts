/**
 * Le catalogue de segments, mis en forme pour la fenêtre « Choisissez vos
 * segments » : un nom et une règle dans la langue du pro, la famille, l'état
 * (déjà créé, indisponible, vide) et le badge « Recommandé ». Pur : testé
 * dans __tests__/segmentCatalog.test.ts.
 */
import type { CatalogItem, NewSegmentItem, SegmentCatalog } from '@/crm/data/segmentCatalog';
import { RECOMMENDED, REC_MIN, SEG_GROUPS, templateBase, templateGroup } from './segments';
import type { SegGroupKey } from './segments';

type T = (k: string, v?: Record<string, string | number>) => string;

export interface CatalogEntry {
  key: string;
  base: string;
  group: SegGroupKey;
  name: string;
  rule: string;
  /** Une idée d'envoi, pour les modèles recommandés seulement. */
  idea: string | null;
  n: number;
  reachable: number;
  def: CatalogItem['def'];
  existing: boolean;
  /** Pas de soirée à venir : « Prochaine soirée » ne veut encore rien dire. */
  disabled: 'noNext' | null;
  /** Recommandé ET assez de monde ET pas déjà créé ET disponible. */
  rec: boolean;
}

export interface CatalogFormat {
  t: T;
  /** Montant sans centimes (« 170 € »). */
  eur: (v: number) => string;
  /** Nom d'un pays depuis son code ISO 2. */
  country: (code: string) => string;
}

/** Nom d'un pays dans la langue de l'écran, le code s'il est inconnu. */
export function countryNamer(lang: string): (code: string) => string {
  let dn: Intl.DisplayNames | null = null;
  try { dn = new Intl.DisplayNames([lang], { type: 'region' }); } catch { dn = null; }
  return (code: string) => {
    try { return dn?.of(code.toUpperCase()) ?? code; } catch { return code; }
  };
}

function vars(it: CatalogItem, f: CatalogFormat): Record<string, string | number> {
  const p = it.params ?? {};
  return {
    threshold: p.threshold !== undefined ? f.eur(Number(p.threshold)) : '',
    area: p.area ?? '',
    home: p.home ? f.country(p.home) : '',
    country: p.code ? f.country(p.code) : '',
  };
}

/** Le catalogue rendu par crm_segment_catalog → les entrées de la fenêtre. */
export function catalogEntries(cat: SegmentCatalog, f: CatalogFormat): CatalogEntry[] {
  const existing = new Set(cat.existing ?? []);
  const out: CatalogEntry[] = [];
  for (const it of cat.items ?? []) {
    const base = templateBase(it.key);
    const group = templateGroup(it.key);
    if (!group) continue;
    // Un modèle calculé sous 10 personnes n'a pas sa place (« Hors de France · 2 »).
    if (base === 'geo_abroad' && it.n < REC_MIN) continue;
    const v = vars(it, f);
    const disabled = group === 'next' && !cat.has_next_event ? 'noNext' : null;
    const isRec = RECOMMENDED.includes(base);
    const done = existing.has(it.key);
    out.push({
      key: it.key,
      base,
      group,
      name: f.t(`yc.seg.tpl.${base}.name`, v),
      rule: f.t(`yc.seg.tpl.${base}.rule`, v),
      idea: isRec ? f.t(`yc.segcat.idea.${base}`) : null,
      n: Number(it.n) || 0,
      reachable: Number(it.reachable) || 0,
      def: it.def,
      existing: done,
      disabled,
      rec: isRec && !done && !disabled && (Number(it.n) || 0) >= REC_MIN,
    });
  }
  return out;
}

/** Les recommandations, dans l'ordre de RECOMMENDED (ce qu'on coche d'office après un import). */
export function recommendedEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((e) => e.rec).sort((a, b) => RECOMMENDED.indexOf(a.base) - RECOMMENDED.indexOf(b.base));
}

/** Dans « Dépense », les seuils calculés sur la base passent avant les montants fixes. */
const LEAD = ['spend_top', 'basket_high'];
const leadRank = (base: string) => (LEAD.includes(base) ? LEAD.indexOf(base) - LEAD.length : 0);

/** Les familles non vides, dans l'ordre du catalogue ; dans une famille, l'ordre du serveur. */
export function groupEntries(entries: CatalogEntry[]): { group: SegGroupKey; entries: CatalogEntry[] }[] {
  return SEG_GROUPS
    .map((group) => ({
      group,
      entries: entries.filter((e) => e.group === group).sort((a, b) => leadRank(a.base) - leadRank(b.base)),
    }))
    .filter((g) => g.entries.length > 0);
}

/** Une entrée se coche : ni déjà créée, ni indisponible. */
export const selectable = (e: CatalogEntry) => !e.existing && !e.disabled;

/** Les segments à créer, nommés dans la langue du pro (le nom reste modifiable ensuite). */
export function toCreateItems(entries: CatalogEntry[], keys: Iterable<string>): NewSegmentItem[] {
  const want = new Set(keys);
  return entries
    .filter((e) => want.has(e.key) && selectable(e))
    .map((e) => ({ template: e.key, name: e.name.slice(0, 80), description: e.rule, definition: e.def }));
}

/** Part de la base pour laquelle une donnée est connue, en points (0-100), null sans base. */
export function coveragePct(known: number, total: number): number | null {
  return total > 0 ? Math.round((known / total) * 100) : null;
}

/** Une recommandation attend-elle (rien de déjà créé, assez de monde) ? Ouvre la fenêtre d'elle-même après un import. */
export function hasNewRecommendation(cat: SegmentCatalog | undefined): boolean {
  if (!cat) return false;
  return recommendedEntries(catalogEntries(cat, { t: (k) => k, eur: String, country: String })).length > 0;
}
