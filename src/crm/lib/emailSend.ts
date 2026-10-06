/**
 * Règles de l'écran Envoi (Audience, Planification, Vérification), sans
 * React : vagues d'envoi, heures calmes du moteur, meilleurs jours et
 * créneaux, liste de vérification.
 *
 * Heures calmes : celles du moteur d'envoi (send-campaign, 23 h → 9 h à
 * Paris), pas un réglage : un e-mail prévu la nuit attend 9 h.
 */
import type { EmailBlock } from '@/lib/email/types';

export const QUIET_FROM = 23;
export const QUIET_TO = 9;

export function inQuietHours(at: Date): boolean {
  const h = at.getHours();
  return h >= QUIET_FROM || h < QUIET_TO;
}

/** Heure de départ réelle d'un envoi programmé, heures calmes comprises. */
export function effectiveSendAt(at: Date, quiet: boolean): { at: Date; shifted: boolean } {
  if (!quiet || !inQuietHours(at)) return { at, shifted: false };
  const out = new Date(at);
  if (at.getHours() >= QUIET_FROM) out.setDate(out.getDate() + 1);
  out.setHours(QUIET_TO, 0, 0, 0);
  return { at: out, shifted: true };
}

export type WaveMinutes = 30 | 60 | 120;
export const WAVE_OPTIONS: readonly WaveMinutes[] = [30, 60, 120];

/**
 * Étaler `n` e-mails sur `minutes` : le moteur lit un plafond par fenêtre
 * glissante (15, 30 ou 60 min, plancher 10). 30 min = 2 fenêtres de 15 ;
 * 1 h = 4 de 15 ; 2 h = 4 de 30.
 */
export function waveThrottle(n: number, minutes: WaveMinutes): { perWindow: number; window: 15 | 30 } {
  const window: 15 | 30 = minutes === 120 ? 30 : 15;
  const windows = Math.max(1, Math.round(minutes / window));
  return { perWindow: Math.max(10, Math.ceil(Math.max(0, n) / windows)), window };
}

/** Relit la durée d'un étalement déjà enregistré (la plus proche des trois). */
export function waveMinutesOf(perWindow: number | null, window: number | null, n: number): WaveMinutes {
  if (!perWindow || !window || n <= 0) return 60;
  const minutes = (n / perWindow) * window;
  return WAVE_OPTIONS.reduce((best, m) => (Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best), 60 as WaveMinutes);
}

export interface GridCell { d: number; h: number; n: number; clicked: number }

/**
 * Meilleurs jours (0 = lundi) et créneaux de 2 h (h = 0 → 8 h-10 h) d'après
 * les clics des 12 derniers mois. Muet sous 50 e-mails par case.
 */
export function bestSlots(grid: GridCell[] | undefined): { days: number[]; hours: number[] } {
  if (!grid?.length) return { days: [], hours: [] };
  const by = (key: 'd' | 'h') => {
    const m = new Map<number, { n: number; c: number }>();
    for (const g of grid) {
      const a = m.get(g[key]) ?? { n: 0, c: 0 };
      a.n += g.n; a.c += g.clicked;
      m.set(g[key], a);
    }
    return [...m.entries()].filter(([, a]) => a.n >= 50).sort((x, y) => y[1].c / y[1].n - x[1].c / x[1].n).slice(0, 2).map(([k]) => k);
  };
  return { days: by('d'), hours: by('h').map((h) => 8 + h * 2) };
}

export type CheckLevel = 'ok' | 'bad' | 'warn' | 'info';
export type CheckFix = 'subject' | 'studio' | 'audience' | 'plan' | 'recharge' | 'billing' | null;

export interface SendCheck { id: string; level: CheckLevel; vars?: Record<string, string | number>; fix: CheckFix }

export interface CheckInput {
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  eventId: string | null;
  net: number;
  balance: number;
  past: boolean;
  demo: boolean;
  /** Compte Yuno CRM en pause (essai fini sans abonnement) : rien ne part. */
  paused?: boolean;
}

const URL_RE = /^https?:\/\/\S+\.\S+/i;

/** La liste de l'étape Vérification (clés `yc.em.sd.ck.<id>.ok|ko`). */
export function sendChecks(x: CheckInput): SendCheck[] {
  const subject = x.subject.replace(/\{\{[^}]+\}\}/g, 'Camille').trim();
  const yuno = x.blocks.filter((b) => b.type === 'event' || b.type === 'tickets' || b.type === 'countdown' || b.type === 'lineup');
  const unbound = yuno.some((b) => !('eventId' in b && b.eventId) && !x.eventId && !(b.type === 'countdown' && b.targetAt));
  const cta = x.blocks.some((b) => (b.type === 'cta' && URL_RE.test(b.url.trim())) || b.type === 'event' || b.type === 'tickets');
  const deadButton = x.blocks.some((b) => b.type === 'cta' && !URL_RE.test(b.url.trim()));
  const images = x.blocks.filter((b) => b.type === 'image' && b.url);
  const altOk = images.every((b) => b.type === 'image' && !!b.label?.trim());
  const usesVars = /\{\{/.test(x.subject + JSON.stringify(x.blocks));
  const list: SendCheck[] = [
    { id: 'subj', level: subject ? 'ok' : 'bad', vars: { subject }, fix: 'subject' },
    { id: 'len', level: subject.length <= 62 ? 'ok' : 'warn', vars: { n: subject.length }, fix: 'subject' },
    { id: 'pre', level: x.preheader.trim() ? 'ok' : 'warn', fix: 'subject' },
    { id: 'cta', level: cta ? 'ok' : 'warn', fix: 'studio' },
  ];
  if (deadButton) list.push({ id: 'link', level: 'bad', fix: 'studio' });
  if (yuno.length) list.push({ id: 'night', level: unbound ? 'bad' : 'ok', fix: 'studio' });
  if (images.length) list.push({ id: 'alt', level: altOk ? 'ok' : 'warn', fix: 'studio' });
  list.push(
    { id: 'aud', level: x.net > 0 ? 'ok' : 'bad', vars: { n: x.net }, fix: 'audience' },
    { id: 'bal', level: x.net <= x.balance ? 'ok' : 'bad', vars: { n: x.net, left: x.balance - x.net, miss: x.net - x.balance }, fix: 'recharge' },
    { id: 'date', level: x.past ? 'bad' : 'ok', fix: 'plan' },
    { id: 'unsub', level: 'ok', fix: null },
    { id: 'dom', level: 'ok', fix: null },
  );
  if (x.paused) list.push({ id: 'paused', level: 'bad', fix: 'billing' });
  if (x.demo) list.push({ id: 'demo', level: 'warn', fix: null });
  list.push({ id: 'var', level: usesVars ? 'ok' : 'info', fix: 'studio' });
  return list;
}

export function verdict(checks: SendCheck[]): { level: 'ok' | 'warn' | 'bad'; bad: number; warn: number } {
  const bad = checks.filter((c) => c.level === 'bad').length;
  const warn = checks.filter((c) => c.level === 'warn').length;
  return { level: bad ? 'bad' : warn ? 'warn' : 'ok', bad, warn };
}
