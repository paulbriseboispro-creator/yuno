import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { healthWord, type HealthLang } from './senderHealthWords';

/**
 * « Santé de vos e-mails » — la lecture `email_sender_health_report`
 * (migration 20261127120000) et sa mise en phrases. Pur sauf le hook : la
 * Console CRM et la Billetterie dessinent la même vue avec leur design.
 */
export type HealthStatus = 'good' | 'watch' | 'limited' | 'paused' | 'new';

export interface SenderLevel { level: number; daily_cap: number; per_hour: number; cold_daily: number; cold_gmail_daily: number; burst: boolean }

export interface HealthReport {
  /** Droits d'envoi (migration 20261127140000) ; absent avant elle. */
  rights?: {
    current: SenderLevel;
    next: SenderLevel | null;
    ladder: SenderLevel[];
    check: {
      level: number; since: string; max_auto: number; next_check_at: string;
      sent: number; bounced: number; complained: number; gmail_relative: number | null;
      checks: Record<'days' | 'volume' | 'bounces' | 'complaints' | 'gmail' | 'no_halt' | 'not_frozen' | 'cap', boolean>;
    };
    history: { at: string; from: number | null; to: number; reason: string }[];
  };
  status: HealthStatus;
  reasons: string[];
  metrics: {
    sent: number; bounced: number; complained: number; opened: number;
    gmail_sent: number; gmail_opened: number; other_sent: number; other_opened: number;
  };
  held: Record<string, number>;
  base: { total: number; engaged: number; contacted: number; never: number; gmail: number; gmail_engaged: number };
  campaigns: {
    id: string; name: string | null; at: string | null; status: string; kind: 'info' | 'marketing';
    wave_state: 'testing' | 'done' | 'halted' | null; wave_released: number | null; wave_total: number | null;
    spread_forced: boolean | null; per_hour: number | null;
    sent: number; bounced: number; complained: number; held: number;
    gmail_sent: number; opened: number; gmail_opened: number;
  }[];
  rules: {
    force_spread: boolean; burst_allowed: boolean; spread_min_audience: number; spread_per_hour: number; spread_max_per_hour: number;
    waves_on: boolean; wave_first: number; wave_max: number; wave_wait_minutes: number; cold_small_max: number;
    cold_daily_cap: number; cold_gmail_daily_cap: number;
    gmail_recovery: boolean; gmail_recovery_since: string | null; gmail_engaged_days: number;
    cold_frozen_until: string | null; frozen_reason: string | null; probation_days: number;
  };
  thresholds: { bounce_pct: number; complaint_permille: number; open_pct: number; gmail_relative: number; watch_bounce_pct: number; watch_open_pct: number; watch_gmail_relative: number };
  generated_at: string;
}

export function useSenderHealth(venueId: string | null | undefined, organizerUserId: string | null | undefined, product: 'crm' | 'suite' | null) {
  const [data, setData] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!venueId && !organizerUserId) return;
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.rpc('email_sender_health_report' as never, {
      p_venue_id: venueId ?? null, p_organizer_user_id: venueId ? null : organizerUserId ?? null, p_product: product,
    } as never);
    if (e) setError(e.message); else setData(d as unknown as HealthReport);
    setLoading(false);
  }, [venueId, organizerUserId, product]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

/** Un taux en points (0-100) écrit à la française ou à l'anglaise ; « — » sans base. */
export function fmtPct(v: number | null, lang: HealthLang, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : lang === 'fr' ? 'fr-FR' : 'es-ES', { maximumFractionDigits: digits }).format(v);
  return lang === 'en' ? `${s}%` : `${s} %`;
}

const rate = (num: number, den: number, min: number) => (den >= min ? (num * 100) / den : null);

export interface HealthTile {
  key: 'sent' | 'bounce' | 'complaints' | 'opens' | 'gmail';
  value: string;
  /** Position sur la jauge (0-1) et seuil, quand il y en a un. */
  gauge?: { ratio: number; threshold: number; tone: 'ok' | 'warn' | 'bad' };
  sub?: string;
}

export interface HealthRule { key: 'recovery' | 'frozen' | 'spread' | 'waves'; active: boolean; text: string; why?: string; lift?: string; ifBad?: string }

export interface RightsView {
  level: number;
  name: string;
  limits: string[];
  ladder: { level: number; name: string; daily: string; on: boolean; passed: boolean }[];
  next: { title: string; checks: { key: string; ok: boolean; label: string }[]; when: string } | null;
  /** Progression vers le niveau suivant : conditions remplies, jours passés au niveau. */
  progress: { passed: number; total: number; days: number; daysNeeded: number; ratio: number; label: string } | null;
  nextNote: string | null;
  history: { at: string; label: string; from: number | null; to: number }[];
}

export interface HealthView {
  rights: RightsView | null;
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
  title: string;
  sub: string;
  reasons: string[];
  platform: { title: string; text: string } | null;
  rules: HealthRule[];
  tiles: HealthTile[];
  base: { total: number; segments: { key: 'engaged' | 'contacted' | 'never'; n: number; label: string; what: string }[]; gmail: string };
  held: { key: string; n: number; label: string }[];
}

/**
 * Toute la page en phrases. `n` formate un entier, `date` une date courte :
 * fournis par le renderer (formats de sa langue).
 */
export function buildHealthView(r: HealthReport, lang: HealthLang, n: (v: number) => string, date: (iso: string) => string): HealthView {
  const w = (k: string, v?: Record<string, string | number | null | undefined>) => healthWord(lang, k, v);
  const m = r.metrics;
  const th = r.thresholds;
  const bounce = rate(m.bounced, m.sent, 50);
  const complaints = m.sent >= 50 ? (m.complained * 1000) / m.sent : null;
  const opens = rate(m.opened, m.sent, 50);
  const g = rate(m.gmail_opened, m.gmail_sent, 30);
  const o = rate(m.other_opened, m.other_sent, 30);
  const frozenUntil = r.rules.cold_frozen_until ? date(r.rules.cold_frozen_until) : '';

  const tone = r.status === 'good' ? 'ok' : r.status === 'watch' ? 'warn' : r.status === 'new' ? 'neutral' : 'bad';
  const reasons = r.reasons.map((code) => {
    if (code === 'bounces_high') return w('reason.bounces_high', { pct: fmtPct(bounce, lang), max: fmtPct(th.bounce_pct, lang, 0) });
    if (code === 'complaints_high') return w('reason.complaints_high', { n: (complaints ?? 0).toFixed(1).replace('.', lang === 'en' ? '.' : ','), max: th.complaint_permille });
    if (code === 'gmail_spam') {
      const x = g && o ? Math.max(2, Math.round(o / Math.max(g, 0.1))) : 2;
      return w('reason.gmail_spam', { x, g: fmtPct(g, lang), o: fmtPct(o, lang) });
    }
    if (code === 'gmail_lagging') return w('reason.gmail_lagging', { g: fmtPct(g, lang), o: fmtPct(o, lang) });
    if (code === 'bounces_rising') return w('reason.bounces_rising', { pct: fmtPct(bounce, lang) });
    if (code === 'opens_low') return w('reason.opens_low', { pct: fmtPct(opens, lang) });
    if (code === 'frozen') {
      const why = w(`why.${(r.rules.frozen_reason ?? '').replace('wave:', '')}`);
      return r.rules.frozen_reason === 'incident' ? `${why.charAt(0).toUpperCase()}${why.slice(1)}.` : w('reason.frozen', { why });
    }
    return code;
  });

  const platform = r.rules.gmail_recovery
    ? { title: w('platform.t', { date: r.rules.gmail_recovery_since ? date(r.rules.gmail_recovery_since) : '' }), text: w('platform.s', { days: r.rules.gmail_engaged_days }) }
    : null;

  const rules: HealthRule[] = [];
  rules.push({
    key: 'recovery', active: r.rules.gmail_recovery,
    text: r.rules.gmail_recovery ? w('rule.recovery.on', { days: r.rules.gmail_engaged_days }) : w('rule.recovery.off'),
    lift: r.rules.gmail_recovery ? w('rule.recovery.lift') : undefined,
  });
  if (r.rules.cold_frozen_until) {
    rules.push({
      key: 'frozen', active: true,
      text: w('rule.frozen.on', { date: frozenUntil, why: reasons.find((_, i) => r.reasons[i] === 'frozen') ?? '' }),
      lift: w('rule.frozen.lift', { date: frozenUntil }),
    });
  }
  rules.push({
    key: 'spread', active: r.rules.force_spread,
    text: r.rules.force_spread
      ? w('rule.spread.on', { max: n(r.rules.spread_max_per_hour), per: n(r.rules.spread_per_hour), min: n(r.rules.spread_min_audience) })
      : w('rule.spread.off'),
    why: w('rule.spread.why'),
    lift: r.rules.force_spread ? w('rule.spread.lift') : undefined,
  });
  rules.push({
    key: 'waves', active: r.rules.waves_on,
    text: w('rule.waves.on', {
      first: n(r.rules.wave_first), max: n(r.rules.wave_max), h: Math.round(r.rules.wave_wait_minutes / 60),
      cap: n(r.rules.cold_daily_cap), gcap: n(r.rules.cold_gmail_daily_cap),
    }),
    why: w('rule.waves.why'),
    ifBad: w('rule.waves.stop', { days: r.rules.probation_days }),
  });

  const gaugeTone = (v: number, warn: number, bad: number): 'ok' | 'warn' | 'bad' => (v > bad ? 'bad' : v > warn ? 'warn' : 'ok');
  const tiles: HealthTile[] = [
    { key: 'sent', value: n(m.sent) },
    bounce == null
      ? { key: 'bounce', value: '—', sub: w('m.tooFew') }
      : { key: 'bounce', value: fmtPct(bounce, lang), sub: w('m.threshold', { v: fmtPct(th.bounce_pct, lang, 0) }),
          gauge: { ratio: Math.min(1, bounce / (th.bounce_pct * 1.5)), threshold: 1 / 1.5, tone: gaugeTone(bounce, th.watch_bounce_pct, th.bounce_pct) } },
    complaints == null
      ? { key: 'complaints', value: '—', sub: w('m.tooFew') }
      : { key: 'complaints', value: complaints.toLocaleString(lang === 'en' ? 'en-GB' : lang, { maximumFractionDigits: 1 }),
          sub: `${w('m.complaints.unit')} · ${w('m.threshold', { v: th.complaint_permille })}`,
          gauge: { ratio: Math.min(1, complaints / (th.complaint_permille * 1.5)), threshold: 1 / 1.5, tone: gaugeTone(complaints, th.complaint_permille * 0.5, th.complaint_permille) } },
    { key: 'opens', value: fmtPct(opens, lang), sub: opens == null ? w('m.tooFew') : undefined },
    g == null || o == null
      ? { key: 'gmail', value: '—', sub: w('m.tooFew') }
      : { key: 'gmail', value: w('m.gmailLine', { g: fmtPct(g, lang), o: fmtPct(o, lang) }),
          gauge: { ratio: Math.min(1, g / Math.max(o, 0.1)), threshold: th.gmail_relative,
                   tone: g / Math.max(o, 0.1) < th.gmail_relative ? 'bad' : g / Math.max(o, 0.1) < th.watch_gmail_relative ? 'warn' : 'ok' } },
  ];

  const recovery = r.rules.gmail_recovery;
  const segments: HealthView['base']['segments'] = [
    { key: 'engaged', n: r.base.engaged, label: w('base.engaged'), what: w('base.engaged.w') },
    { key: 'contacted', n: r.base.contacted, label: w('base.contacted'), what: w(recovery ? 'base.contacted.w' : 'base.contacted.w2') },
    { key: 'never', n: r.base.never, label: w('base.never'), what: w(recovery ? 'base.never.w' : 'base.never.w2') },
  ];

  const known = new Set(['gmail_cold', 'cold_wave_halted', 'cold_frozen', 'cold_wave_late', 'event_started', 'fatigue', 'pressure_24h', 'pressure_7d',
    'unengaged', 'junk_address', 'refocus_low_opens', 'refocus_gmail']);
  const held: HealthView['held'] = [];
  let other = 0;
  for (const [k, v] of Object.entries(r.held ?? {})) {
    if (known.has(k)) held.push({ key: k, n: v, label: w(`held.${k}`) });
    else other += v;
  }
  held.sort((a, b) => b.n - a.n);
  if (other > 0) held.push({ key: 'other', n: other, label: w('held.other') });

  let rights: RightsView | null = null;
  if (r.rights) {
    const R = r.rights;
    const cur = R.current;
    const c = R.check;
    const lim = [w('rights.daily', { n: n(cur.daily_cap) }), w('rights.hour', { n: n(cur.per_hour) }), w('rights.cold', { n: n(cur.cold_daily), g: n(cur.cold_gmail_daily) })];
    if (cur.burst) lim.push(w('rights.burst'));
    const pctOf = (a: number, b: number) => (b >= 50 ? fmtPct((a * 100) / b, lang) : '—');
    const nextAuto = R.next && R.next.level <= 4;
    rights = {
      level: cur.level,
      name: w(`lvl.${cur.level}`),
      limits: lim,
      ladder: R.ladder.map((l) => ({ level: l.level, name: w(`lvl.${l.level}`), daily: n(l.daily_cap), on: l.level === cur.level, passed: l.level < cur.level })),
      next: nextAuto && R.next ? {
        title: w('rights.next.t', { n: R.next.level, name: w(`lvl.${R.next.level}`) }),
        checks: (['days', 'volume', 'bounces', 'complaints', 'gmail', 'no_halt', 'not_frozen', 'cap'] as const).map((k) => ({
          key: k, ok: !!c.checks?.[k],
          label: w(`chk.${k}`, {
            n: k === 'cap' ? c.max_auto : n(c.sent),
            v: k === 'bounces' ? pctOf(c.bounced, c.sent)
              : k === 'complaints' ? (c.sent >= 50 ? ((c.complained * 1000) / c.sent).toLocaleString(lang === 'en' ? 'en-GB' : lang, { maximumFractionDigits: 1 }) : '—')
              : k === 'gmail' ? (c.gmail_relative == null ? '—' : fmtPct(c.gmail_relative * 100, lang, 0)) : '',
          }),
        })),
        when: w('rights.next.at', { date: date(c.next_check_at) }),
      } : null,
      progress: nextAuto ? (() => {
        const vals = Object.values(c.checks ?? {});
        const passed = vals.filter(Boolean).length;
        const total = vals.length || 8;
        const days = Math.min(7, Math.max(0, Math.floor((Date.now() - new Date(c.since).getTime()) / 86_400_000)));
        return { passed, total, days, daysNeeded: 7, ratio: passed / total, label: w('rights.progress', { p: passed, t: total, d: days }) };
      })() : null,
      nextNote: !R.next ? w('rights.top') : !nextAuto ? w('rights.next.manual') : null,
      history: R.history.map((h) => ({ at: date(h.at), label: w(`hist.${h.reason}`), from: h.from, to: h.to })),
    };
  }

  // Récidive (20261129100000) : fermé jusqu'à décision de Yuno, pas de date à afficher.
  const recidive = r.status === 'paused' && r.rules.frozen_reason === 'recidive';
  return {
    rights,
    tone,
    title: recidive ? w('status.recidive') : r.status === 'paused' ? w('status.paused', { date: frozenUntil }) : w(`status.${r.status}`),
    sub: recidive ? w('status.recidive.s') : r.status === 'paused' ? w('status.paused.s', { date: frozenUntil }) : w(`status.${r.status}.s`),
    reasons: r.status === 'paused' ? reasons : reasons.filter((_, i) => r.reasons[i] !== 'frozen'),
    platform,
    rules,
    tiles,
    base: { total: r.base.total, segments, gmail: w('base.gmail', { n: n(r.base.gmail), e: n(r.base.gmail_engaged) }) },
    held,
  };
}

/** Comment une campagne est partie (colonne « Départ »). */
export function campaignModeLabel(c: HealthReport['campaigns'][number], lang: HealthLang): string {
  if (c.wave_state === 'halted') return healthWord(lang, 'c.mode.halted');
  if (c.wave_state === 'testing') return healthWord(lang, 'c.mode.waves', { r: c.wave_released ?? 1, t: c.wave_total ?? 1 });
  if (c.wave_state === 'done') return healthWord(lang, 'c.mode.done');
  if (c.per_hour != null) return healthWord(lang, 'c.mode.spread', { n: c.per_hour });
  return healthWord(lang, 'c.mode.burst');
}
