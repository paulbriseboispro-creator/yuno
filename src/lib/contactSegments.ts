// Segments sur la base importée — vocabulaire partagé front.
//
// Le serveur (`analyze_contact_lists`) rend des propositions avec une CLÉ
// stable (« geo_zone:paris », « spend_tables »…) et des paramètres chiffrés ;
// c'est ici qu'on en fait un nom et une raison dans la langue du pro. Le nom
// traduit est ce qui est enregistré en base (`contact_segments.name`) : c'est
// lui que le pro retrouve à l'écran Audience.

import { supabase } from '@/integrations/supabase/client';

export type SegmentGroup = 'geo' | 'spend' | 'freq' | 'recency' | 'demo' | 'consent' | 'channel' | 'engagement' | 'source';

export interface SegmentSuggestion {
  key: string;
  group: SegmentGroup;
  definition: { version: number; match: string; conditions: Array<Record<string, unknown>> };
  params: Record<string, string | number | null>;
  contacts: number;
  emails: number;
  phones: number;
  share: number;
  existing_id: string | null;
}

export interface ContactAnalysis {
  generated_at: string;
  contacts: number;
  lists: number;
  min_size?: number;
  home_country?: string | null;
  coverage?: Record<string, number>;
  facts?: {
    top_countries?: Array<{ code: string; n: number }>;
    zone_field?: 'zone' | 'city';
    top_zones?: Array<{ value: string; n: number }>;
    spend?: { zero: number; paid: number; median_paid: number; top_threshold: number; total: number; tables: number };
    events?: { one: number; two_three: number; four_plus: number };
    recency?: { d90: number; d365: number; older: number };
    age?: { avg: number | null; b18_21: number; b22_25: number; b26_30: number; b31: number };
    gender?: { female: number; male: number };
    newsletter_yes?: number;
    channels?: { emails: number; phones: number; both: number; emails_reachable: number; phones_reachable: number };
    /** Ce que les campagnes ont appris (depuis 2026-09-15). */
    engagement?: { campaigns: number; sent_any: number; active: number; passive: number; silent: number; new: number; unreachable: number; unsubscribed: number };
    /** Fichier importé / venus par Yuno / les deux. */
    origin?: { import: number; yuno: number; both: number; with_account: number };
  };
  campaigns?: number;
  suggestions: SegmentSuggestion[];
}

export interface ContactSegment {
  id: string;
  name: string;
  description: string | null;
  definition: SegmentSuggestion['definition'];
  origin: 'suggested' | 'manual';
  suggestion_key: string | null;
  created_at: string;
  counts: { contacts: number; emails: number; phones: number };
}

export interface ContactListSummary {
  id: string;
  list_name: string | null;
  filename: string | null;
  created_at: string;
  row_count: number;
  email_count: number;
  phone_count: number;
  both_count: number;
  analyzed_at: string | null;
  email_import_id: string | null;
  sms_import_id: string | null;
}

export interface ContactIntelligenceOverview {
  lists: ContactListSummary[];
  segments: ContactSegment[];
  /** Fichier importé ∪ clients venus par Yuno, une ligne par email. */
  contacts: number;
  reachable_emails?: number;
  reachable_phones?: number;
  engagement?: { active: number; passive: number; silent: number; new: number; unreachable: number; unsubscribed: number; sent_any: number };
  origin?: { import: number; yuno: number; both: number; with_account: number };
  refreshed_at?: string | null;
  /** Bilans des dernières campagnes (voir src/lib/contactBase.ts). */
  impacts?: unknown[];
  analysis: ContactAnalysis | null;
}

export const SEGMENT_GROUPS: SegmentGroup[] = ['engagement', 'source', 'geo', 'spend', 'freq', 'recency', 'demo', 'consent', 'channel'];

// ── Les segments Yuno — ceux de la plaquette, en un clic ────────────────────
//
// L'analyseur serveur (`analyze_contact_lists`) ne propose un segment qu'à
// partir de 10 personnes et 30 % de couverture : sur une base qui démarre,
// « Prend des tables » n'apparaissait jamais. Ces quatre définitions sont
// FIXES, calculées sur la base vivante (billets + tables + guest list, cf.
// contact_rows), et proposées aux deux portées avec leur effectif du moment.
// Même contrat de sauvegarde que les propositions (`save_contact_segments`,
// dédoublonné par `suggestion_key`) : un préréglage devient un vrai segment,
// recalculé à chaque envoi.

export interface YunoSegmentPreset {
  key: string;
  group: SegmentGroup;
  definition: SegmentSuggestion['definition'];
  params: Record<string, string | number | null>;
}

const def = (conditions: Array<Record<string, unknown>>): SegmentSuggestion['definition'] =>
  ({ version: 1, match: 'all', conditions });

/**
 * Seuil du « panier moyen élevé » établi par Yuno — le même que l'analyseur
 * (spend_tables) : en dessous, un profil billet ; à partir de là, un profil
 * table ou bouteille. Le pro peut le remplacer par le sien (voir
 * `basketPreset`) : un club à 900 € la table et un bar à 15 € l'entrée n'ont
 * pas le même « panier élevé ».
 */
export const YUNO_BASKET_THRESHOLD = 60;
export const BASKET_THRESHOLD_MIN = 1;
export const BASKET_THRESHOLD_MAX = 100000;

/** Clé du segment « panier moyen élevé » : celle de l'analyseur au seuil Yuno,
 *  suffixée sinon (« spend_tables:80 ») — `suggestionBase` retombe sur le même
 *  libellé, et deux seuils différents font deux segments. */
export function basketPresetKey(threshold: number): string {
  return threshold === YUNO_BASKET_THRESHOLD ? 'spend_tables' : `spend_tables:${threshold}`;
}

/** Seuil saisi → entier borné ; une saisie vide ou invalide retombe sur Yuno. */
export function normalizeBasketThreshold(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < BASKET_THRESHOLD_MIN) return YUNO_BASKET_THRESHOLD;
  return Math.min(BASKET_THRESHOLD_MAX, n);
}

export function basketPreset(threshold: number = YUNO_BASKET_THRESHOLD): YunoSegmentPreset {
  const t = normalizeBasketThreshold(threshold);
  return {
    key: basketPresetKey(t),
    group: 'spend',
    definition: def([{ type: 'spent_per_event', op: 'gte', value: t }]),
    params: { threshold: t },
  };
}

export const BASKET_PRESET_BASE = 'spend_tables';

/**
 * La valeur Yuno du panier, établie PAR PORTÉE par `suggest_basket_threshold`
 * (migration 20260916140000) : 3e quartile de la dépense par soirée quand il
 * y a assez de paniers payés, sinon le prix par convive de la formule de
 * table la moins chère, sinon 1,5 × le billet le plus cher, sinon 60 €.
 */
export interface BasketSuggestion {
  threshold: number;
  basis: 'history' | 'offer_tables' | 'offer_tickets' | 'default';
  payers: number;
  p75: number;
  median: number;
  max_ticket: number;
  min_table_pp: number;
}

export const DEFAULT_BASKET_SUGGESTION: BasketSuggestion = {
  threshold: YUNO_BASKET_THRESHOLD, basis: 'default', payers: 0, p75: 0, median: 0, max_ticket: 0, min_table_pp: 0,
};

/** Jamais d'exception : en cas d'échec, la valeur de repli (60 €, base « default »). */
export async function loadBasketSuggestion(
  scopeArgs: { p_venue_id: string | null; p_organizer_user_id: string | null },
): Promise<BasketSuggestion> {
  try {
    const { data, error } = await supabase.rpc('suggest_basket_threshold' as never, scopeArgs as never);
    if (error) throw error;
    const d = (data as unknown as Partial<BasketSuggestion> | null) || {};
    const threshold = normalizeBasketThreshold(d.threshold);
    const basis = (['history', 'offer_tables', 'offer_tickets', 'default'] as const).includes(d.basis as never)
      ? (d.basis as BasketSuggestion['basis']) : 'default';
    return {
      threshold, basis,
      payers: Number(d.payers || 0), p75: Number(d.p75 || 0), median: Number(d.median || 0),
      max_ticket: Number(d.max_ticket || 0), min_table_pp: Number(d.min_table_pp || 0),
    };
  } catch {
    return DEFAULT_BASKET_SUGGESTION;
  }
}

/** « 3e quartile de vos 412 paniers », « d'après vos formules de table »… */
export function describeBasketBasis(s: BasketSuggestion, t: (k: string) => string, language: string): string {
  const raw = t(`cseg.basket.basis.${s.basis}`);
  if (raw === `cseg.basket.basis.${s.basis}`) return '';
  return raw
    .replace('{payers}', nf(s.payers, language))
    .replace('{ticket}', nf(Math.round(s.max_ticket), language))
    .replace('{pp}', nf(Math.round(s.min_table_pp), language));
}

/** Les préréglages, avec le seuil de panier demandé (Yuno par défaut). */
export function yunoSegmentPresets(opts: { basketThreshold?: number } = {}): YunoSegmentPreset[] {
  return [
    // A déjà réservé au moins une table VIP chez ce pro.
    { key: 'yuno_tables', group: 'spend', definition: def([{ type: 'tables', op: 'gte', value: 1 }]), params: {} },
    // Dépense par soirée au-dessus du seuil (même clé que l'analyseur au seuil
    // Yuno : un segment déjà créé depuis les propositions n'est pas dupliqué).
    basketPreset(opts.basketThreshold),
    // Vus (achat, venue, clic) il y a moins de 60 jours : encore chauds.
    { key: 'yuno_seen_60', group: 'recency', definition: def([{ type: 'last_seen_days', op: 'lte', value: 60 }]), params: { days: 60 } },
    // Venaient souvent, plus rien depuis trois mois.
    { key: 'yuno_lapsing', group: 'recency', definition: def([{ type: 'events', op: 'gte', value: 3 }, { type: 'last_seen_days', op: 'gt', value: 90 }]), params: { days: 90 } },
  ];
}

export const YUNO_SEGMENT_PRESETS: readonly YunoSegmentPreset[] = yunoSegmentPresets();

/**
 * Les préréglages sous forme de propositions, avec leur effectif LIVE
 * (`count_contact_segment_def`, le même compteur que l'écran Audience) et
 * l'id du segment s'il existe déjà. Les préréglages vides sont tus : « Prend
 * des tables · 0 » n'aide personne. Un échec de comptage tait le préréglage.
 */
export async function loadYunoPresetSuggestions(
  scopeArgs: { p_venue_id: string | null; p_organizer_user_id: string | null },
  existing: ReadonlyArray<{ id: string; suggestion_key: string | null }>,
  totalContacts: number,
  opts: { basketThreshold?: number } = {},
): Promise<SegmentSuggestion[]> {
  const out: SegmentSuggestion[] = [];
  const presets = yunoSegmentPresets(opts);
  await Promise.all(presets.map(async (p) => {
    const { data, error } = await supabase.rpc('count_contact_segment_def' as never, {
      ...scopeArgs, p_definition: p.definition as never,
    } as never);
    if (error) return;
    const c = (data as unknown as { contacts?: number; emails?: number; phones?: number } | null) || {};
    const contacts = Number(c.contacts || 0);
    // Le panier reste visible même vide : c'est son champ de seuil qui permet
    // au pro de descendre jusqu'à trouver du monde.
    if (contacts <= 0 && suggestionBase(p.key) !== BASKET_PRESET_BASE) return;
    out.push({
      key: p.key,
      group: p.group,
      definition: p.definition,
      params: p.params,
      contacts,
      emails: Number(c.emails || 0),
      phones: Number(c.phones || 0),
      share: totalContacts > 0 ? contacts / totalContacts : 0,
      existing_id: existing.find((s) => s.suggestion_key === p.key)?.id ?? null,
    });
  }));
  // Ordre stable : celui de la liste, pas celui des réponses réseau.
  out.sort((a, b) => presets.findIndex((p) => p.key === a.key) - presets.findIndex((p) => p.key === b.key));
  return out;
}

/** Ce que l'écran Audience affiche de la base : segments enregistrés,
 *  préréglages Yuno pas encore créés, et la taille de la base vivante. */
export interface ContactSegmentPanel {
  contacts: number;
  segments: ContactSegment[];
  presets: SegmentSuggestion[];
}

/**
 * TOUT l'écran Audience en UN aller-retour : les segments enregistrés de la
 * portée ET l'effectif des préréglages Yuno (`get_contact_segment_panel`,
 * migration 20260917130000).
 *
 * Pourquoi un seul appel : chaque comptage reconstruit la base vivante
 * (fichier importé ∪ clients venus par Yuno). Sur 12 000 contacts cette
 * construction coûte ~2,5 s ; l'écran en lançait six en parallèle alors que
 * le rôle `authenticated` est coupé à 8 s par requête. La vue d'ensemble
 * perdait la course, elle était annulée, et la section « Segments
 * intelligents » disparaissait sans un mot.
 *
 * Contrairement à `loadYunoPresetSuggestions`, cette fonction LÈVE en cas
 * d'échec : l'appelant garde ce qu'il affichait et retente, au lieu de
 * conclure que le pro n'a aucun segment.
 */
export async function loadContactSegmentPanel(
  scopeArgs: { p_venue_id: string | null; p_organizer_user_id: string | null },
  opts: { basketThreshold?: number; presets?: readonly YunoSegmentPreset[] } = {},
): Promise<ContactSegmentPanel> {
  const presets = opts.presets ?? yunoSegmentPresets(opts);
  const { data, error } = await supabase.rpc('get_contact_segment_panel' as never, {
    ...scopeArgs,
    p_presets: presets.map((p) => ({ key: p.key, definition: p.definition })) as never,
  } as never);
  if (error) throw error;
  const d = (data as unknown as {
    contacts?: number;
    segments?: ContactSegment[];
    presets?: Array<{ key: string; counts?: { contacts?: number; emails?: number; phones?: number } }>;
  } | null) || {};
  const segments = (d.segments || []) as ContactSegment[];
  const total = Number(d.contacts || 0);
  const counts = new Map((d.presets || []).map((p) => [p.key, p.counts || {}]));
  const out: SegmentSuggestion[] = [];
  for (const p of presets) {
    const c = counts.get(p.key) || {};
    const contacts = Number(c.contacts || 0);
    // Le panier reste visible même vide : c'est son champ de seuil qui permet
    // au pro de descendre jusqu'à trouver du monde.
    if (contacts <= 0 && suggestionBase(p.key) !== BASKET_PRESET_BASE) continue;
    out.push({
      key: p.key,
      group: p.group,
      definition: p.definition,
      params: p.params,
      contacts,
      emails: Number(c.emails || 0),
      phones: Number(c.phones || 0),
      share: total > 0 ? contacts / total : 0,
      existing_id: segments.find((s) => s.suggestion_key === p.key)?.id ?? null,
    });
  }
  return { contacts: total, segments, presets: out };
}

/** « geo_zone:paris » → « geo_zone ». */
export function suggestionBase(key: string): string {
  return key.split(':')[0];
}

export function countryName(code: string | null | undefined, language: string): string {
  if (!code) return '';
  try {
    const dn = new Intl.DisplayNames([language === 'es' ? 'es' : language === 'en' ? 'en' : 'fr'], { type: 'region' });
    return dn.of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

const nf = (n: number, language: string) => n.toLocaleString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR');

/**
 * Nom + raison d'une proposition, traduits. `t` est le helper i18n du
 * dictionnaire ; les clés vivent sous `cseg.sug.<base>.name|why`.
 */
export function describeSuggestion(
  s: Pick<SegmentSuggestion, 'key' | 'params' | 'contacts' | 'share'>,
  t: (k: string) => string,
  language: string,
): { name: string; why: string } {
  const base = suggestionBase(s.key);
  const p = s.params || {};
  const vars: Record<string, string> = {
    n: nf(s.contacts, language),
    pct: String(Math.round((s.share || 0) * 100)),
    country: countryName(p.code as string, language),
    home: countryName(p.home as string, language),
    zone: String(p.zone ?? ''),
    threshold: nf(Number(p.threshold ?? 0), language),
    median: nf(Number(p.median ?? 0), language),
    days: String(p.days ?? ''),
  };
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const nameKey = `cseg.sug.${base}.name`;
  const whyKey = `cseg.sug.${base}.why`;
  const name = t(nameKey);
  const why = t(whyKey);
  return {
    name: fill(name === nameKey ? s.key : name),
    why: fill(why === whyKey ? '' : why),
  };
}
