import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { HealthReport } from './senderHealth';

/**
 * Les schémas de la page « Santé de vos e-mails » : la lecture
 * `email_sender_health_visual` (migration 20261129100000) et ses règles de
 * dessin, pures et testées. La page parle par schémas ; les phrases longues
 * restent repliées sous « Pourquoi ces règles ? ».
 */
export interface HealthVisual {
  today: {
    sent: number; daily_cap: number;
    cold: number; cold_cap: number;
    cold_gmail: number; cold_gmail_cap: number;
    cold_month: number; cold_month_cap: number;
    per_hour: number; level: number; shared_max_level: number;
  };
  series: {
    d: string; sent: number; bounced: number; complained: number;
    gmail_sent: number; gmail_opened: number; other_sent: number; other_opened: number; held: number;
  }[];
  smart: { on: boolean; unengaged: number; junk: number; refocus: number; min_audience: number; min_received: number; days: number };
  incidents: { at: string; kind: 'wave_halt' | 'breaker' | 'probation' | 'low_opens'; campaign_id: string | null; campaign: string | null }[];
  recidive_count: number;
  recidive_window_days: number;
  thresholds: { bounce_pct: number; complaint_permille: number; gmail_relative: number; guard_open_pct: number };
  generated_at: string;
}

export function useSenderHealthVisual(venueId: string | null | undefined, organizerUserId: string | null | undefined, product: 'crm' | 'suite' | null) {
  const [data, setData] = useState<HealthVisual | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!venueId && !organizerUserId) return;
    setLoading(true);
    const { data: d, error } = await supabase.rpc('email_sender_health_visual' as never, {
      p_venue_id: venueId ?? null, p_organizer_user_id: venueId ? null : organizerUserId ?? null, p_product: product,
    } as never);
    // Base d'avant la migration : la page garde ses autres blocs, sans les schémas.
    setData(error ? null : (d as unknown as HealthVisual));
    setLoading(false);
  }, [venueId, organizerUserId, product]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, reload: load };
}

export type Tone = 'ok' | 'warn' | 'bad' | 'none';

/** Une jauge « utilisé / plafond » : part remplie (0-1) et ton. */
export function usage(used: number, cap: number): { ratio: number; left: number; tone: Tone } {
  if (!cap || cap <= 0) return { ratio: used > 0 ? 1 : 0, left: 0, tone: 'none' };
  const ratio = Math.min(1, Math.max(0, used / cap));
  return { ratio, left: Math.max(0, cap - used), tone: ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'warn' : 'ok' };
}

/** Un point par jour : envois, et taux d'ouverture Gmail / autres dès 20 envois ce jour-là. */
export const MIN_DAY_SAMPLE = 20;
export function chartPoints(series: HealthVisual['series']) {
  return series.map((p) => ({
    d: p.d,
    sent: p.sent,
    gmail: p.gmail_sent >= MIN_DAY_SAMPLE ? (p.gmail_opened * 100) / p.gmail_sent : null,
    other: p.other_sent >= MIN_DAY_SAMPLE ? (p.other_opened * 100) / p.other_sent : null,
  }));
}

export interface Signal {
  key: 'bounce' | 'complaints' | 'gmail';
  /** Valeur mesurée, ou null sous l'échantillon minimal. */
  value: number | null;
  /** Bornes de la barre : [fin du vert, fin de l'orange, max]. Pour Gmail, plus c'est haut mieux c'est. */
  zones: [number, number, number];
  higherIsBetter: boolean;
  limit: number;
  tone: Tone;
}

/**
 * Les trois signaux, sur les 30 derniers jours (`metrics` du rapport) :
 * rebonds en %, plaintes pour 1 000, Gmail en part des ouvertures des autres.
 * Mêmes seuils que le serveur (`thresholds` du rapport).
 */
export function signals(r: HealthReport): Signal[] {
  const m = r.metrics;
  const th = r.thresholds;
  const bounce = m.sent >= 50 ? (m.bounced * 100) / m.sent : null;
  const compl = m.sent >= 50 ? (m.complained * 1000) / m.sent : null;
  const g = m.gmail_sent >= 30 ? m.gmail_opened / m.gmail_sent : null;
  const o = m.other_sent >= 30 ? m.other_opened / m.other_sent : null;
  const rel = g != null && o != null && o > 0 ? g / o : null;
  const bounceWarn = Math.min(th.watch_bounce_pct, th.bounce_pct * 0.75);
  const up = (v: number | null, warn: number, bad: number): Tone => (v == null ? 'none' : v > bad ? 'bad' : v > warn ? 'warn' : 'ok');
  return [
    { key: 'bounce', value: bounce, zones: [bounceWarn, th.bounce_pct, Math.max(th.bounce_pct * 2, 1)], higherIsBetter: false,
      limit: th.bounce_pct, tone: up(bounce, bounceWarn, th.bounce_pct) },
    { key: 'complaints', value: compl, zones: [th.complaint_permille / 2, th.complaint_permille, th.complaint_permille * 2], higherIsBetter: false,
      limit: th.complaint_permille, tone: up(compl, th.complaint_permille / 2, th.complaint_permille) },
    { key: 'gmail', value: rel == null ? null : rel * 100, zones: [th.gmail_relative * 100, th.watch_gmail_relative * 100, 120], higherIsBetter: true,
      limit: th.gmail_relative * 100,
      tone: rel == null ? 'none' : rel < th.gmail_relative ? 'bad' : rel < th.watch_gmail_relative ? 'warn' : 'ok' },
  ];
}

export interface CanDo { key: string; state: 'yes' | 'limited' | 'no' | 'soon'; word: string; vars?: Record<string, string | number> }

/**
 * Ce que le compte peut faire, une ligne chacun, dans l'ordre où un pro se
 * pose la question. `n` formate un entier.
 */
export function canDo(r: HealthReport, v: HealthVisual | null, n: (x: number) => string): CanDo[] {
  const cur = r.rights?.current;
  const frozen = !!r.rules.cold_frozen_until;
  const coldDay = v ? v.today.cold_cap : r.rules.cold_daily_cap;
  const gmailDay = v ? v.today.cold_gmail_cap : r.rules.cold_gmail_daily_cap;
  const out: CanDo[] = [
    { key: 'engaged', state: 'yes', word: 'v.can.engaged' },
    { key: 'daily', state: 'limited', word: 'v.can.daily', vars: { n: n(v?.today.daily_cap ?? cur?.daily_cap ?? 0) } },
    { key: 'hour', state: 'limited', word: 'v.can.hour', vars: { n: n(v?.today.per_hour ?? cur?.per_hour ?? r.rules.spread_per_hour) } },
    frozen || !r.rules.waves_on || coldDay <= 0
      ? { key: 'cold', state: 'no', word: 'v.can.cold.off' }
      : { key: 'cold', state: 'limited', word: 'v.can.cold', vars: { n: n(coldDay) } },
  ];
  if (v && !frozen) out.push({ key: 'month', state: 'limited', word: 'v.can.month', vars: { n: n(v.today.cold_month_cap) } });
  out.push(frozen || gmailDay <= 0
    ? { key: 'gmail', state: 'no', word: 'v.can.gmail.off' }
    : { key: 'gmail', state: 'limited', word: 'v.can.gmail', vars: { n: n(gmailDay) } });
  out.push(r.rules.burst_allowed ? { key: 'burst', state: 'yes', word: 'v.can.burst.on' } : { key: 'burst', state: 'no', word: 'v.can.burst.off' });
  if (v?.smart.on) out.push({ key: 'smart', state: 'yes', word: 'v.can.smart' });
  out.push({ key: 'domain', state: 'soon', word: 'v.can.domain' });
  return out;
}
