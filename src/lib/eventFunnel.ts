/**
 * Le tunnel d'achat d'UNE soirée, mesuré en base (`event_funnel_events`,
 * migration 20260930243000) pour l'Analytics › Trafic › Par soirée.
 *
 * Aucun point de tir nouveau dans les pages : le tunnel est déjà marqué pour
 * PostHog (`event_viewed`, `ticket_tier_selected`, `checkout_started`,
 * `purchase_completed`…), et chaque événement porte l'id de la soirée. Ce
 * module TRADUIT ces événements en étapes du tunnel, une seule fois, depuis
 * `capturePosthog` — ajouter un point de tir PostHog à une page l'ajoute donc
 * au tunnel sans rien faire d'autre.
 *
 * Mêmes règles que la mesure de visites (`useVisitorTracking`) :
 *  - rien sans le consentement « mesure d'audience » ;
 *  - rien sur une surface pro, rien en session d'accès assisté ;
 *  - aucune donnée personnelle : un identifiant de session aléatoire par
 *    onglet, l'appareil, la source d'arrivée et les ids de ligne choisie.
 * Fire-and-forget : une mesure ne bloque ni n'échoue jamais une page.
 */
import { supabase } from '@/integrations/supabase/client';
import { hasAnalyticsConsent } from '@/lib/consent';
import { isProApp, isProPath } from '@/lib/native';
import { isSupportSessionActive } from '@/lib/supportSession';
import { categorizeReferrer } from '@/lib/referrerCategory';

export type FunnelStep =
  | 'viewed' | 'selected' | 'checkout' | 'details' | 'payment' | 'purchased'
  | 'failed' | 'waitlist' | 'shared' | 'followed';
export type FunnelPillar = 'tickets' | 'tables' | 'guest_list';

export interface FunnelRow {
  eventId: string;
  step: FunnelStep;
  pillar: FunnelPillar | null;
  ref: string | null;
  quantity: number | null;
  amountCents: number | null;
  reason: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PILLARS: readonly string[] = ['tickets', 'tables', 'guest_list'];

const asPillar = (v: unknown): FunnelPillar | null => (typeof v === 'string' && PILLARS.includes(v) ? (v as FunnelPillar) : null);
const asInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
const cents = (price: unknown, qty: number | null): number | null => {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null;
  return Math.round(price * 100 * Math.max(1, qty ?? 1));
};

/**
 * Un événement du plan de marquage → l'étape du tunnel qu'il représente, ou
 * `null` s'il n'en est pas une (boissons, découverte, pro…). Pure, testée.
 */
export function funnelRowFor(event: string, props: Record<string, unknown> | undefined): FunnelRow | null {
  const p = props ?? {};
  const eventId = typeof p.event_id === 'string' && UUID_RE.test(p.event_id) ? p.event_id.toLowerCase() : null;
  if (!eventId) return null;
  const base = { eventId, pillar: null, ref: null, quantity: null, amountCents: null, reason: null } as const;
  const pillar = asPillar(p.pillar);

  switch (event) {
    case 'event_viewed':
      return { ...base, step: 'viewed' };
    case 'ticket_tier_selected': {
      const quantity = asInt(p.quantity);
      return { ...base, step: 'selected', pillar: 'tickets', ref: asStr(p.tier_id), quantity, amountCents: cents(p.price, quantity) };
    }
    case 'table_pack_selected': {
      const quantity = asInt(p.guests);
      return { ...base, step: 'selected', pillar: 'tables', ref: asStr(p.pack_id), quantity, amountCents: cents(p.price, 1) };
    }
    case 'checkout_started':
      return pillar ? { ...base, step: 'checkout', pillar } : null;
    case 'checkout_step_completed': {
      if (!pillar) return null;
      // Le choix d'un billet / d'une formule est déjà une étape `selected` ;
      // seule la liste (sans palier ni formule) n'a que ce signal.
      if (p.step === 'tier') return pillar === 'guest_list' ? { ...base, step: 'selected', pillar } : null;
      if (p.step === 'details') return { ...base, step: 'details', pillar, quantity: asInt(p.quantity ?? p.guests) };
      if (p.step === 'payment') return { ...base, step: 'payment', pillar };
      return null;
    }
    case 'purchase_completed':
      return pillar && pillar !== 'guest_list' ? { ...base, step: 'purchased', pillar, quantity: asInt(p.quantity) } : null;
    case 'guest_list_joined':
      return { ...base, step: 'purchased', pillar: 'guest_list' };
    case 'checkout_failed':
      return pillar ? { ...base, step: 'failed', pillar, reason: asStr(p.reason) } : null;
    case 'waitlist_joined':
      return { ...base, step: 'waitlist', pillar: 'tickets' };
    case 'event_shared':
      return { ...base, step: 'shared' };
    case 'event_hosts_followed':
      return { ...base, step: 'followed', quantity: asInt(p.hosts) };
    default:
      return null;
  }
}

// ── Session du tunnel ─────────────────────────────────────────────────────────
// Indépendante de `yuno_session_id` : celle-là change quand la portée change
// (club, soirée) au milieu d'un parcours, ce qui couperait le tunnel en deux.
const SID_KEY = 'yuno_funnel_sid';
const SRC_KEY = 'yuno_funnel_src';

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function sessionInfo(): { sid: string; source: string } | null {
  try {
    let sid = sessionStorage.getItem(SID_KEY);
    if (!sid) {
      sid = randomId();
      sessionStorage.setItem(SID_KEY, sid);
    }
    // La source est celle de l'ARRIVÉE dans l'onglet : `document.referrer` ne
    // change pas au fil d'une navigation interne, l'URL d'atterrissage oui.
    let source = sessionStorage.getItem(SRC_KEY);
    if (!source) {
      const params = new URLSearchParams(window.location.search);
      source = categorizeReferrer(document.referrer, params.get('utm_medium'), params);
      sessionStorage.setItem(SRC_KEY, source);
    }
    return { sid, source };
  } catch {
    return null;
  }
}

function deviceType(): 'mobile' | 'tablet' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function onProSurface(): boolean {
  if (isProApp()) return true;
  try {
    return isProPath(window.location.pathname);
  } catch {
    return false;
  }
}

/** Écrit l'étape du tunnel qui correspond à cet événement du plan de marquage, si c'en est une. */
export function mirrorFunnelEvent(event: string, props: Record<string, unknown> | undefined): void {
  if (typeof window === 'undefined') return;
  const row = funnelRowFor(event, props);
  if (!row) return;
  if (!hasAnalyticsConsent() || onProSurface() || isSupportSessionActive()) return;
  const info = sessionInfo();
  if (!info) return;
  void Promise.resolve(
    supabase.rpc('track_event_funnel' as never, {
      p_session_id: info.sid,
      p_event_id: row.eventId,
      p_step: row.step,
      p_pillar: row.pillar,
      p_ref: row.ref,
      p_quantity: row.quantity,
      p_amount_cents: row.amountCents,
      p_reason: row.reason,
      p_device: deviceType(),
      p_source: info.source,
    } as never),
  ).catch(() => { /* mesure best-effort : ne bloque jamais la navigation */ });
}
