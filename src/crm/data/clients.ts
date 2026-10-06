/**
 * Données de l'écran Clients : vue d'ensemble, liste filtrée (paginée côté
 * serveur), fiche client, notes et étiquettes, segments enregistrés, soirées
 * du filtre, effectifs d'une audience (« Écrire à… »).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type Lifecycle = 'hab' | 'occ' | 'nou' | 'end' | 'none';

/** Définition d'un filtre de clients (= d'un segment « à vous »). */
export interface ClientFilterDef {
  seg?: 'all' | Lifecycle;
  f?: {
    ev?: string[];
    last?: '' | '0-30' | '30-90' | '90-180' | '180+';
    last_gt_days?: number;
    nb?: '' | '0' | '1' | '2' | '3-5' | '6+';
    sp?: '' | '<50' | '50-200' | '200+';
    rc?: ('mail' | 'sms' | 'none')[];
    src?: ('shotgun' | 'utm' | 'import' | 'page' | 'other')[];
    tags?: string[];
    /** Liste fixe : une sélection enregistrée en segment. */
    emails?: string[];
    /** Réponse aux messages : 3 reçus sans clic, clic sans achat sous 7 jours, aucun reçu en 12 mois. */
    msg?: '' | 'never_clicked' | 'clicked_no_buy' | 'never_sent';
    /*
     * Catalogue de segments (migration 20261008200000). Une valeur illisible
     * ne retient personne (_crm_filter_sql).
     */
    /** Nombre de soirées faites, bornes comprises. */
    nb_min?: number;
    nb_max?: number;
    /** Dernière soirée il y a moins de N jours. */
    last_lt_days?: number;
    /** Dépense totale (€) au moins égale. */
    sp_min?: number;
    /** Dépense par soirée payée (€) au moins égale. */
    basket_min?: number;
    /** Billets payants, au moins. */
    paid_min?: number;
    /** Âge connu (Shotgun, sinon vos fichiers), bornes comprises. */
    age_min?: number;
    age_max?: number;
    gender?: 'female' | 'male' | 'other';
    /** Clés de ville (`_crm_area_key` : minuscules, sans accents). */
    area?: string[];
    /** Pays (ISO 2) ; `country_not` : pays connu, autre que celui-ci. */
    country?: string[];
    country_not?: string;
    /** A (ou non) un billet ou une invitation pour une soirée pas encore commencée. */
    up?: 'yes' | 'no';
    /** A cliqué un lien d'e-mail il y a moins de N jours. */
    click_lt_days?: number;
    /** Canaux joignables : les deux, e-mail seul, SMS seul. */
    ch?: 'both' | 'email_only' | 'sms_only';
    /**
     * Guest list Shotgun (migration 20261008100000) : déjà invité, invité qui
     * n'a jamais payé, habitué de la guest list (3 soirées, jamais payé),
     * devenu client, inscrit qui ne vient pas (2 fois, porte scannée).
     */
    gl?: '' | 'any' | 'only' | 'loyal' | 'conv' | 'noshow';
    /** Invités (invitation ou billet gratuit) de ces soirées. */
    glev?: string[];
  };
  q?: string;
}

/**
 * Le filtre pose-t-il au moins un critère ? Toute clé de `f` non vide compte,
 * y compris une clé que la liste ne dessine pas (`msg`, âge, ville… d'un
 * segment enregistré) : sinon « Écrire à… » visait toute la base.
 */
export function hasCriteria(d: ClientFilterDef): boolean {
  if ((d.seg ?? 'all') !== 'all' || !!d.q?.trim()) return true;
  return Object.values(d.f ?? {}).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''));
}

export interface ClientsOverview {
  total: number; today: number; month: number;
  lifecycle: Record<Lifecycle, number>;
  end_reachable: number; reachable: number; unreachable: number;
  returning_pct: number | null; once: number; avg_spend: number | null;
  spark: number[];
  prev: { total: number; returning_pct: number | null; avg_spend: number | null };
  rules: { min_nights: number; window_months: number; lapse_months: number };
  updated_at: string;
}

/** Source d'une vente telle que Shotgun la rend, avec son nom côté Yuno (`_crm_source_label`). */
export interface SaleSourceLabel {
  src: string | null;
  kind: 'yl' | 'em' | 'sm' | 'dm' | 'so' | 'sg' | 'au' | 'di' | 'of';
  label?: string | null;
  platform?: string | null;
  placement?: string | null;
  event_id?: string | null;
}

export interface ClientRow {
  email: string; first_name: string | null; last_name: string | null; lifecycle: Lifecycle;
  nights: number; last_night: string | null; added_at: string | null; spent: number;
  email_ok: boolean; phone_ok: boolean; tonight: boolean; tag: string | null; source: string;
  /** Soirées en guest list ; `gl_only` : jamais un billet payant. */
  gl?: number; gl_only?: boolean;
}

export interface ClientsList { total: number; rows: ClientRow[]; counts: Record<'all' | Lifecycle, number> }

export interface ClientCard {
  email: string; first_name: string | null; last_name: string | null; phone: string | null;
  email_ok: boolean; phone_ok: boolean; bounced: boolean; eng_status: string;
  /** `spent` : null pour un rôle qui ne voit pas l'argent (_crm_null_money). */
  lifecycle: Lifecycle; nights: number; nights_win: number; spent: number | null;
  first_night: string | null; last_night: string | null; added_at: string | null;
  tonight: boolean; source: string; utm_source: string | null; origin: string | null;
  /** Source du premier achat, lisible (lien de partage, campagne…). */
  first_source?: SaleSourceLabel | null;
  tags: string[]; note: string | null;
  buys: { kind: 'buy'; at: string; event_id: string; title: string | null; event_start: string; amount: number; tickets: number; scanned: boolean; first: boolean; upcoming: boolean; source?: SaleSourceLabel | null }[];
  messages: {
    kind: 'email'; at: string; name: string | null; campaign_id: string; opened: boolean; clicked: boolean;
    /** La soirée dont parlait l'e-mail, le premier clic, et l'achat de cette soirée qui a suivi (null = non mesurable). */
    event_id?: string | null; event_title?: string | null; clicked_at?: string | null; bought_after?: boolean | null;
  }[];
  months: { m: string; n: number }[];
  rules: { min_nights: number; window_months: number; lapse_months: number };
  /** Une ligne par soirée où la personne était invitée ou inscrite gratuitement. */
  guests?: {
    kind: 'guest'; event_id: string; title: string | null; event_start: string; at: string;
    gl: 'inv' | 'free' | 'mix'; list: string | null; came: boolean; scanned_at: string | null;
    /** Faux = on ne sait pas si elle est venue (porte non scannée). */
    scan_known: boolean; upcoming: boolean;
  }[];
  gl?: { n: number; came: number; first: string | null; conv: boolean; paid_n: number; noshow: number };
  /**
   * Historique d'un fichier importé (migration 20261008210000) : ce que dit le
   * fichier et comment il compte — 'added' ajouté aux billets Shotgun (ou
   * seule source), 'file' plus complet que Shotgun donc retenu, 'live' déjà
   * compris dans Shotgun. `spent` est null pour un rôle qui ne voit pas l'argent.
   */
  history?: { nights: number; spent: number | null; last: string | null; mode: 'added' | 'file' | 'live'; list: string | null } | null;
}

export interface SavedSegment { id: string; name: string; description: string | null; template: string | null; definition: ClientFilterDef; n: number; reachable: number; created_at: string }
export interface EventBrief { id: string; title: string | null; start_at: string; upcoming: boolean }

export function useClientsOverview() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({ queryKey: ['crm', qk, 'clients-overview'], queryFn: () => rpc<ClientsOverview>('crm_clients_overview', args), staleTime: 60_000 });
}

export function useClientsList(def: ClientFilterDef, sort: string, dir: number, limit: number) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'clients-list', def, sort, dir, limit],
    queryFn: () => rpc<ClientsList>('crm_clients_list', { ...args, p_def: def, p_sort: sort, p_dir: dir, p_limit: limit, p_offset: 0 }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useClientCard(email: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'client', email],
    queryFn: () => rpc<ClientCard | null>('crm_client', { ...args, p_email: email }),
    enabled: !!email,
    staleTime: 30_000,
  });
}

export function useSaveClient() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { email: string; tags?: string[]; note?: string }) =>
      rpc('crm_client_save', { ...args, p_email: p.email, p_tags: p.tags ?? null, p_note: p.note ?? null }),
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: ['crm', qk, 'client', p.email] });
      if (p.tags) qc.invalidateQueries({ queryKey: ['crm', qk, 'clients-list'] });
    },
  });
}

export function useSegmentsBrief() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({ queryKey: ['crm', qk, 'segments-brief'], queryFn: () => rpc<SavedSegment[]>('crm_segments_brief', args), staleTime: 60_000 });
}

export function useSaveSegment() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id?: string | null; name: string; definition: ClientFilterDef; template?: string | null; description?: string | null }) =>
      rpc<{ id: string }>('crm_segment_save', { ...args, p_id: p.id ?? null, p_name: p.name, p_definition: p.definition, p_template: p.template ?? null, p_description: p.description ?? null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', qk, 'segments-brief'] }); qc.invalidateQueries({ queryKey: ['crm', qk, 'segments'] }); },
  });
}

export function useDeleteSegment() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<boolean>('crm_segment_delete', { ...args, p_id: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', qk, 'segments-brief'] }); qc.invalidateQueries({ queryKey: ['crm', qk, 'segments'] }); },
  });
}

export function useEventsBrief(limit = 12) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({ queryKey: ['crm', qk, 'events-brief', limit], queryFn: () => rpc<EventBrief[]>('crm_events_brief', { ...args, p_limit: limit }), staleTime: 5 * 60_000 });
}

export function useAudienceCount(def: ClientFilterDef | null, emails: string[] | null, enabled: boolean) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'audience-count', def, emails],
    queryFn: () => rpc<{ total: number; email: number; sms: number }>('crm_audience_count', { ...args, p_def: def, p_emails: emails }),
    enabled,
    staleTime: 30_000,
  });
}

/** Une audience préparée depuis Clients ou Segments, reprise par l'éditeur. */
export interface PendingAudience {
  channel: 'email' | 'sms';
  label: string;
  def?: ClientFilterDef;
  emails?: string[];
  segmentId?: string;
  /** La soirée que le message annonce (écran Soirées) : le brouillon lui sera relié. */
  eventId?: string;
  count: number;
}

const PENDING_KEY = 'yuno.crm.pendingAudience';

export function setPendingAudience(a: PendingAudience) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(a)); } catch { /* sans stockage, l'éditeur repart sans audience */ }
}

export function takePendingAudience(): PendingAudience | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw) as PendingAudience;
  } catch { return null; }
}

export function peekPendingAudience(): PendingAudience | null {
  try { const raw = sessionStorage.getItem(PENDING_KEY); return raw ? (JSON.parse(raw) as PendingAudience) : null; } catch { return null; }
}
