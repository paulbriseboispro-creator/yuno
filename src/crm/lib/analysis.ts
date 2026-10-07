/**
 * Yuno CRM — analyse client : « Ce qui fait venir ».
 *
 * Règles pures partagées par les écrans (fiche client, Analyses ›
 * Communauté, tiroir d'une soirée, artistes, Admin CRM) et testées
 * (`__tests__/analysis.test.ts`). Le calcul vit en SQL (migrations
 * 20261010100000 → 140000) ; `statusOf` en est le MIROIR EXACT, testé sur les
 * mêmes cas que le smoke SQL.
 *
 * On n'affirme jamais : une hypothèse est un FAIT (« a vu Malaa 2 fois ») suivi
 * du statut de sa famille sur le compte. Interdit à l'écran : « vient pour »,
 * « fan de », « aime », « son ami », « il préfère ».
 */

export type AnKind = 'affinity' | 'behaviour' | 'return';

export const AFFINITY = ['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series'] as const;
export const BEHAVIOUR = ['early', 'launch', 'last_minute', 'door', 'group', 'table'] as const;
export const RETURN = ['discovery', 'passing', 'invited', 'group_first', 'brought', 'channel'] as const;

export type AnFamily = (typeof AFFINITY)[number] | (typeof BEHAVIOUR)[number] | (typeof RETURN)[number];

export const FAMILIES: readonly AnFamily[] = [...AFFINITY, ...BEHAVIOUR, ...RETURN];

export function familyKind(f: AnFamily): AnKind {
  if ((AFFINITY as readonly string[]).includes(f)) return 'affinity';
  if ((BEHAVIOUR as readonly string[]).includes(f)) return 'behaviour';
  return 'return';
}

/** Statut calculé par le moteur (crm_family_status.status). */
export type AnStatus = 'untested' | 'supported' | 'not_supported' | 'inconclusive';
/** Disponibilité de la matière (lot A) ; « uniform » : toutes les soirées pareilles. */
export type AnAvailability = 'ok' | 'reduced' | 'unavailable' | 'uniform';
/** Ce que l'écran affiche. `prior_only` : observée sur d'autres comptes Yuno seulement. */
export type DisplayStatus = 'supported' | 'not_supported' | 'untested' | 'prior_only' | 'off';
export type Strength = 'strong' | 'medium' | 'weak';

export interface AnPrior { accounts: number; gain: number | null; status: AnStatus; n?: number }

export interface FamilyStatus {
  family: AnFamily;
  variant: string;
  kind: AnKind;
  availability: AnAvailability;
  status: AnStatus;
  o: number; e: number; n: number;
  gain: number | null; z: number | null;
  direction: 'more' | 'less' | null;
  detail: { r1?: number | null; r0?: number | null; returned?: number; n0?: number | null; base?: number; transitions?: number };
  since: string | null;
  computed_at?: string;
  prior: AnPrior | null;
}

/** Seuils par défaut (crm_analysis_rules, version 1). */
export const DEFAULT_RULES = {
  min_sample: 10,
  status: { min_n: 30, gain_supported: 1.3, z_supported: 2, gain_not: 1.1, z_not: 1 },
  return: { min_n: 30, gap: 0.3, z: 2 },
} as const;

type Rules = { status: { min_n: number; gain_supported: number; z_supported: number; gain_not: number; z_not: number }; return: { min_n: number; gap: number; z: number } };

/**
 * Miroir de `_crm_an_status` (SQL). Affinité et comportement : gain = O/E,
 * z = (O − E)/√V. Retour : gain = O/E (E = n × taux des autres), z sur deux
 * proportions, rendu par le moteur.
 */
export function statusOf(
  kind: AnKind,
  x: { o: number; e: number; v: number; n: number; n0?: number | null; z?: number | null },
  rules: Rules = DEFAULT_RULES,
): AnStatus {
  if (kind === 'return') {
    if (x.n < rules.return.min_n || (x.n0 ?? 0) < rules.return.min_n || x.e <= 0 || x.z === null || x.z === undefined) return 'untested';
    const gap = Math.abs(x.o / x.e - 1);
    if (gap >= rules.return.gap && Math.abs(x.z) >= rules.return.z) return 'supported';
    if (gap < 0.1 || Math.abs(x.z) < rules.status.z_not) return 'not_supported';
    return 'inconclusive';
  }
  if (x.n < rules.status.min_n || x.e <= 0 || x.v <= 0) return 'untested';
  const gain = x.o / x.e;
  const z = (x.o - x.e) / Math.sqrt(x.v);
  if (gain >= rules.status.gain_supported && z >= rules.status.z_supported) return 'supported';
  if (gain < rules.status.gain_not || z < rules.status.z_not) return 'not_supported';
  return 'inconclusive';
}

/** Statut affiché : une famille éteinte se tait, une leçon commune reste à part. */
export function displayStatus(f: { status?: AnStatus | null; availability?: AnAvailability | null; prior?: AnPrior | null } | null | undefined): DisplayStatus {
  if (!f || !f.status) return 'untested';
  if (f.availability === 'unavailable' || f.availability === 'uniform') return 'off';
  if (f.status === 'supported' || f.status === 'not_supported') return f.status;
  if (f.prior && (f.prior.status === 'supported' || f.prior.status === 'not_supported')) return 'prior_only';
  return 'untested';
}

/** Un taux n'existe qu'à partir de `min` personnes (MIN_SAMPLE) : sinon null, l'écran montre les nombres. */
export function rateOrNull(num: number | null | undefined, den: number | null | undefined, min: number = DEFAULT_RULES.min_sample): number | null {
  if (num === null || num === undefined || den === null || den === undefined || den < min || den <= 0) return null;
  return num / den;
}

const STRENGTH_RANK: Record<Strength, number> = { strong: 3, medium: 2, weak: 1 };

export interface Hypothesis {
  f: AnFamily;
  s: Strength;
  /** Clé de preuve (`artist.repeat`, `buy.launch`…) : texte `yc.why.ev.<k>`. */
  k: string;
  p: Record<string, unknown>;
  status?: AnStatus | null;
  availability?: AnAvailability | null;
  kind?: AnKind | null;
  gain?: number | null;
  o?: number | null;
  e?: number | null;
  n?: number | null;
  direction?: 'more' | 'less' | null;
  detail?: FamilyStatus['detail'] | null;
  since?: string | null;
  prior?: AnPrior | null;
}

/** Les hypothèses à montrer d'abord : force, puis famille confirmée sur le compte. */
export function topHypotheses(hs: Hypothesis[], max = 2): Hypothesis[] {
  const ds = (h: Hypothesis) => displayStatus(h);
  return hs
    .filter((h) => ds(h) !== 'off')
    .map((h, i) => ({ h, i }))
    .sort((a, b) => STRENGTH_RANK[b.h.s] - STRENGTH_RANK[a.h.s]
      || Number(ds(b.h) === 'supported') - Number(ds(a.h) === 'supported')
      || a.i - b.i)
    .slice(0, max)
    .map((x) => x.h);
}

/** Les clés de preuve que le moteur peut rendre (une clé `yc.why.ev.<k>` chacune, trois langues). */
export const EVIDENCE_KEYS = [
  'artist.repeat', 'artist.repeat_series', 'artist.first_rare', 'artist.rare_seen',
  'genre.dominant', 'genre.single',
  'format.dominant', 'slot.dominant', 'weekday.dominant', 'place.dominant',
  'series.lineups', 'series.same',
  'buy.early', 'buy.launch', 'buy.last_minute', 'buy.door',
  'group.with', 'group.buys_for', 'table.seat',
  'brought.first', 'discovery.first', 'invited.first', 'channel.first',
  'passing.far', 'passing.foreign',
] as const;

/** Preuves qui ont une forme au singulier (`<clé>.one`) quand `of` vaut 1. */
export const ONE_FORM_KEYS = ['buy.early', 'buy.launch', 'buy.last_minute', 'buy.door', 'group.with', 'group.buys_for'] as const;

/** La clé de texte d'une preuve : singulier quand il n'y a qu'une venue. */
export function evidenceKey(k: string, p: Record<string, unknown> | null | undefined): string {
  return (ONE_FORM_KEYS as readonly string[]).includes(k) && Number(p?.of) === 1 ? `${k}.one` : k;
}

/** Créneaux d'une soirée (`_crm_an_slot`). */
export const SLOTS = ['after', 'day', 'sunset', 'evening', 'night'] as const;

/**
 * Les familles qui peuvent porter une recommandation de segment : confirmées
 * sur le compte ; pour un groupe de retour, seulement s'il revient DAVANTAGE —
 * sauf « de passage », qui recommande les locaux quand les gens de passage
 * reviennent MOINS.
 */
export function supportedForSegments(families: Pick<FamilyStatus, 'family' | 'variant' | 'kind' | 'status' | 'availability' | 'direction'>[]): Set<string> {
  const out = new Set<string>();
  for (const f of families) {
    if (f.variant !== '' || displayStatus({ status: f.status, availability: f.availability }) !== 'supported') continue;
    if (f.kind !== 'return') out.add(f.family);
    else if (f.family === 'passing' ? f.direction === 'less' : f.direction === 'more') out.add(f.family);
  }
  return out;
}
