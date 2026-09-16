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

/** Seuil du « panier moyen élevé » — le même que l'analyseur (spend_tables). */
export const YUNO_BASKET_THRESHOLD = 60;

export const YUNO_SEGMENT_PRESETS: readonly YunoSegmentPreset[] = [
  // A déjà réservé au moins une table VIP chez ce pro.
  { key: 'yuno_tables', group: 'spend', definition: def([{ type: 'tables', op: 'gte', value: 1 }]), params: {} },
  // Dépense par soirée au-dessus du seuil (même clé que l'analyseur : un
  // segment déjà créé depuis les propositions n'est pas dupliqué).
  { key: 'spend_tables', group: 'spend', definition: def([{ type: 'spent_per_event', op: 'gte', value: YUNO_BASKET_THRESHOLD }]), params: { threshold: YUNO_BASKET_THRESHOLD } },
  // Vus (achat, venue, clic) il y a moins de 60 jours : encore chauds.
  { key: 'yuno_seen_60', group: 'recency', definition: def([{ type: 'last_seen_days', op: 'lte', value: 60 }]), params: { days: 60 } },
  // Venaient souvent, plus rien depuis trois mois.
  { key: 'yuno_lapsing', group: 'recency', definition: def([{ type: 'events', op: 'gte', value: 3 }, { type: 'last_seen_days', op: 'gt', value: 90 }]), params: { days: 90 } },
];

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
): Promise<SegmentSuggestion[]> {
  const out: SegmentSuggestion[] = [];
  await Promise.all(YUNO_SEGMENT_PRESETS.map(async (p) => {
    const { data, error } = await supabase.rpc('count_contact_segment_def' as never, {
      ...scopeArgs, p_definition: p.definition as never,
    } as never);
    if (error) return;
    const c = (data as unknown as { contacts?: number; emails?: number; phones?: number } | null) || {};
    const contacts = Number(c.contacts || 0);
    if (contacts <= 0) return;
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
  out.sort((a, b) => YUNO_SEGMENT_PRESETS.findIndex((p) => p.key === a.key) - YUNO_SEGMENT_PRESETS.findIndex((p) => p.key === b.key));
  return out;
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
