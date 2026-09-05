// Yuno Links — le mini-linktree de la bio Instagram / TikTok (route /links).
//
// Tout ce que la page et son back-office admin partagent : la forme de la
// configuration (une ligne `links_page_config`, éditée depuis /admin/links),
// les payloads des RPC publiques, et la mesure d'audience.
//
// Mesure SANS cookie, même modèle que src/lib/platformTraffic.ts : aucun
// identifiant côté client, le serveur reconstruit le visiteur (hash salé-jour
// IP+UA). Tout est fire-and-forget — une panne de tracking ne touche jamais
// l'UX, et un super admin connecté n'est jamais compté (garde serveur).
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { Language } from '@/i18n/data';
import { isNative } from '@/lib/native';

export const LINKS_PATH = '/links';
export const LINKS_PUBLIC_URL = `https://yunoapp.eu${LINKS_PATH}`;

// ─── Configuration ──────────────────────────────────────────────────────────

export interface LinksConfig {
  instagram_fr: string;
  instagram_intl: string;
  tiktok: string;
  /** Numéro WhatsApp du fondateur, format international (+33…). Vide = pas de WhatsApp. */
  whatsapp_number: string;
  app_store_url: string;
  /** Villes « en direct » affichées sous le logo et dans le pied de page. */
  live_cities: string[];
  /** Pastilles proposées dans la liste d'attente (« Autre » est ajouté par la page). */
  waitlist_cities: string[];
  show_featured: boolean;
  show_waitlist: boolean;
  show_pros: boolean;
  featured_limit: number;
}

export const DEFAULT_LINKS_CONFIG: LinksConfig = {
  instagram_fr: 'https://www.instagram.com/yunoapp.fr/',
  instagram_intl: 'https://www.instagram.com/yunoapp.eu',
  tiktok: '',
  whatsapp_number: '',
  app_store_url: 'https://apps.apple.com/us/app/yuno-nightlife-tickets/id6799487527',
  live_cities: ['Madrid', 'Paris'],
  waitlist_cities: ['Lyon', 'Bordeaux', 'Toulouse', 'Marseille', 'Barcelona'],
  show_featured: true,
  show_waitlist: true,
  show_pros: true,
  featured_limit: 6,
};

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.trim() : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function strList(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
  return out.length ? out.slice(0, 12) : fallback;
}

/** Tolère une config partielle ou abîmée : chaque champ retombe sur son défaut. */
export function normalizeLinksConfig(raw: unknown): LinksConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LINKS_CONFIG;
  const limit = Number(r.featured_limit);
  return {
    instagram_fr: str(r.instagram_fr, d.instagram_fr),
    instagram_intl: str(r.instagram_intl, d.instagram_intl),
    tiktok: str(r.tiktok, d.tiktok),
    whatsapp_number: str(r.whatsapp_number, d.whatsapp_number),
    app_store_url: str(r.app_store_url, d.app_store_url) || d.app_store_url,
    live_cities: strList(r.live_cities, d.live_cities),
    waitlist_cities: strList(r.waitlist_cities, d.waitlist_cities),
    show_featured: bool(r.show_featured, d.show_featured),
    show_waitlist: bool(r.show_waitlist, d.show_waitlist),
    show_pros: bool(r.show_pros, d.show_pros),
    featured_limit: Number.isFinite(limit) && limit >= 1 ? Math.min(12, Math.round(limit)) : d.featured_limit,
  };
}

export async function fetchLinksConfig(): Promise<LinksConfig> {
  try {
    const { data } = await supabase.from('links_page_config').select('config').eq('id', 'default').maybeSingle();
    return normalizeLinksConfig(data?.config);
  } catch {
    return DEFAULT_LINKS_CONFIG;
  }
}

export async function saveLinksConfig(config: LinksConfig): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('links_page_config')
    .update({
      config: config as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: auth.user?.id ?? null,
    })
    .eq('id', 'default');
  if (error) throw error;
}

/** Le compte Instagram qui correspond à la langue du visiteur : FR → yunoapp.fr, sinon yunoapp.eu. */
export function instagramFor(config: LinksConfig, language: Language): string {
  return (language === 'fr' ? config.instagram_fr : config.instagram_intl) || config.instagram_intl || config.instagram_fr;
}

/** Lien WhatsApp « clic pour écrire » — wa.me n'accepte que des chiffres. */
export function whatsappUrl(number: string, text: string): string | null {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// ─── Payloads des RPC publiques ─────────────────────────────────────────────

export interface LinksStats {
  venues: number;
  upcoming_events: number;
  weekend_events: number;
  cities: string[];
}

export interface FeaturedItem {
  kind: 'yuno' | 'affiliate';
  id: string;
  path: string;
  title: string;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  venue_name: string | null;
  city: string | null;
  is_live: boolean;
  min_price: number | null;
  is_free: boolean;
  has_guest_list: boolean;
}

export async function fetchLinksStats(): Promise<LinksStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_links_public_stats');
    if (error || !data) return null;
    const d = data as unknown as Partial<LinksStats>;
    return {
      venues: Number(d.venues ?? 0),
      upcoming_events: Number(d.upcoming_events ?? 0),
      weekend_events: Number(d.weekend_events ?? 0),
      cities: Array.isArray(d.cities) ? (d.cities as string[]) : [],
    };
  } catch {
    return null;
  }
}

export async function fetchFeaturedEvents(limit: number): Promise<FeaturedItem[]> {
  try {
    const { data, error } = await supabase.rpc('get_links_featured_events', { p_limit: limit });
    if (error || !Array.isArray(data)) return [];
    return data as unknown as FeaturedItem[];
  } catch {
    return [];
  }
}

// ─── Mesure d'audience ──────────────────────────────────────────────────────

export type LinksClickTarget =
  | 'app_store'
  | 'web_app'
  | 'instagram'
  | 'tiktok'
  | 'whatsapp'
  | 'share'
  | 'featured_all'
  | `event:${string}`;

function trackable(): boolean {
  if (import.meta.env.DEV) return false;
  if (isNative()) return true;
  const h = window.location.hostname;
  return h === 'yunoapp.eu' || h.endsWith('.yunoapp.eu');
}

function acquisitionParams() {
  const params = new URLSearchParams(window.location.search);
  let referrerHost: string | null = null;
  try {
    if (document.referrer) referrerHost = new URL(document.referrer).hostname;
  } catch {
    // référent illisible : le visiteur comptera comme « direct »
  }
  return {
    p_referrer_host: referrerHost,
    p_utm_source: params.get('utm_source') || null,
    p_utm_medium: params.get('utm_medium') || null,
    p_utm_campaign: params.get('utm_campaign') || null,
    p_lang: navigator.language || null,
  };
}

/** Une vue de page ou un clic qui laisse la page ouverte (lien externe, nouvel onglet). */
export function trackLinksEvent(kind: 'view' | 'click', target?: LinksClickTarget, meta?: Record<string, unknown>): void {
  if (!trackable()) return;
  supabase
    .rpc('track_links_event', {
      p_kind: kind,
      p_target: target ?? null,
      ...acquisitionParams(),
      p_meta: (meta ?? {}) as Record<string, never>,
    })
    .then(
      () => {},
      () => {},
    );
}

/**
 * Même clic, en keepalive : à utiliser juste AVANT une navigation dans le même
 * onglet (web app, page d'une soirée). Le SDK ne survit pas au déchargement de
 * la page, un fetch keepalive oui — pattern de platformTraffic.
 */
export function trackLinksClickKeepalive(target: LinksClickTarget, meta?: Record<string, unknown>): void {
  if (!trackable()) return;
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/track_links_event`;
    const body = JSON.stringify({
      p_kind: 'click',
      p_target: target,
      ...acquisitionParams(),
      p_meta: meta ?? {},
    });
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // jamais bloquer une navigation pour une mesure
  }
}

// ─── Payload de l'analytics admin (get_links_analytics) ─────────────────────

export interface LinksAnalytics {
  granularity: 'hour' | 'day';
  totals: { views: number; visitors: number; clicks: number; click_visitors: number; waitlist: number; pro_leads: number };
  series: { t: string; views: number; visitors: number; clicks: number; signups: number }[];
  targets: { target: string; clicks: number; visitors: number }[];
  events: { event_id: string; title: string | null; clicks: number }[];
  langs: { k: string; n: number }[];
  countries: { k: string; n: number }[];
  devices: { k: string; n: number }[];
  referrers: { k: string; n: number }[];
  utm: { k: string; n: number }[];
  waitlist_cities: { k: string; n: number }[];
  lead_types: { k: string; n: number }[];
}

export interface LinksProLead {
  id: string;
  created_at: string;
  name: string;
  org_name: string | null;
  org_type: 'club' | 'organizer' | 'promoter' | 'agency' | 'other';
  city: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  lang: string | null;
  contacted_at: string | null;
  notes: string | null;
}
