// Segments sur la base importée — vocabulaire partagé front.
//
// Le serveur (`analyze_contact_lists`) rend des propositions avec une CLÉ
// stable (« geo_zone:paris », « spend_tables »…) et des paramètres chiffrés ;
// c'est ici qu'on en fait un nom et une raison dans la langue du pro. Le nom
// traduit est ce qui est enregistré en base (`contact_segments.name`) : c'est
// lui que le pro retrouve à l'écran Audience.

export type SegmentGroup = 'geo' | 'spend' | 'freq' | 'recency' | 'demo' | 'consent' | 'channel';

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
  };
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
  contacts: number;
  analysis: ContactAnalysis | null;
}

export const SEGMENT_GROUPS: SegmentGroup[] = ['geo', 'spend', 'freq', 'recency', 'demo', 'consent', 'channel'];

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
