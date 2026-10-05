/**
 * Règles de lecture de la guest list Shotgun (migration 20261008100000).
 * Pures et testées : la porte « est-ce une entrée de guest list ? » (miroir
 * EXACT de `_crm_ticket_gl_kind`), les heures d'arrivée et la phrase qui
 * ouvre l'écran. Un chiffre qui ne se mesure pas n'est jamais rendu à 0 :
 * il revient `null` et l'écran le dit.
 */

/** Seuil sous lequel un pourcentage ne se montre pas (même règle que le reste de Yuno). */
export const GL_MIN_SAMPLE = 10;

export type GlTicketKind = 'inv' | 'free';

/**
 * Miroir de `_crm_ticket_gl_kind(status, price, raw)` : une invitation Shotgun
 * (`deal_channel = 'invitation'`) ou un billet valide à 0 €. Tout autre billet
 * (payant, annulé, remboursé, revendu, en attente) n'est pas une entrée, ni un
 * duplicata (`deal_channel = 'duplicata'`, la copie d'un billet existant —
 * migration 20261008130000).
 */
export function glKindOf(status: string | null | undefined, price: number | null | undefined, raw: unknown): GlTicketKind | null {
  if (status !== 'valid') return null;
  const channel = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).deal_channel : undefined;
  if (channel === 'duplicata') return null;
  if (channel === 'invitation') return 'inv';
  if (price === 0) return 'free';
  return null;
}

/** « 23:52 » depuis des minutes comptées à partir de midi (0 = 12:00, 795 = 01:15). */
export function clockFromNoon(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  const tot = (((Math.round(m) + 720) % 1440) + 1440) % 1440;
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}

/** Libellé court d'une heure de la nuit (« 23 h », « 11 pm », « 23 h »). */
export function hourLabel(h: number, lang: 'en' | 'fr' | 'es'): string {
  if (lang === 'en') return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
  return `${h} h`;
}

/** Pourcentage arrondi à une décimale, ou null sous l'échantillon minimal. */
export function rate(part: number, whole: number, min = GL_MIN_SAMPLE): number | null {
  if (!(whole >= min) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** Écart en points entre deux pourcentages (null si l'un manque). */
export function ptsDelta(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return Math.round((a - b) * 10) / 10;
}

export type GlPhase = 'upcoming' | 'live' | 'past';

export interface NightVerdictInput {
  phase: GlPhase;
  scanKnown: boolean;
  entries: number;
  came: number;
  showup: number | null;
  freeShare: number | null;
  prev: { title: string; sameDay: number; entries: number; showup: number | null } | null;
}

export interface Verdict { key: string; vars: Record<string, number | string>; cmp?: { key: string; vars: Record<string, number | string> } }

/**
 * La phrase qui ouvre l'onglet Guest list d'une soirée. Avant la soirée : les
 * inscrits, comparés à la fois d'avant AU MÊME MOMENT. Pendant : déjà entrés.
 * Après : venus / inscrits — seulement si la porte a vraiment scanné.
 */
export function nightVerdict(d: NightVerdictInput): Verdict {
  if (d.entries === 0) return { key: d.phase === 'past' ? 'yc.gl.v.nonePast' : 'yc.gl.v.noneUp', vars: {} };
  if (d.phase === 'upcoming') {
    if (!d.prev) return { key: 'yc.gl.v.up', vars: { n: d.entries } };
    const diff = d.entries - d.prev.sameDay;
    return {
      key: diff > 0 ? 'yc.gl.v.upMore' : diff < 0 ? 'yc.gl.v.upLess' : 'yc.gl.v.upSame',
      vars: { n: d.entries, diff: Math.abs(diff), title: d.prev.title },
    };
  }
  if (d.phase === 'live') return { key: 'yc.gl.v.live', vars: { came: d.came, n: d.entries } };
  if (!d.scanKnown) return { key: 'yc.gl.v.pastNoScan', vars: { n: d.entries } };
  // Porte scannée mais moins de 10 inscrits : les nombres, sans pourcentage.
  if (d.showup === null) return { key: 'yc.gl.v.pastSmall', vars: { came: d.came, n: d.entries } };
  const v: Verdict = { key: 'yc.gl.v.past', vars: { came: d.came, n: d.entries, pct: d.showup } };
  const gap = d.prev ? ptsDelta(d.showup, d.prev.showup) : null;
  if (d.prev && gap !== null) {
    v.cmp = Math.abs(gap) < 2
      ? { key: 'yc.gl.v.cmpSame', vars: { title: d.prev.title } }
      : { key: gap > 0 ? 'yc.gl.v.cmpUp' : 'yc.gl.v.cmpDown', vars: { n: Math.abs(Math.round(gap)), title: d.prev.title } };
  }
  return v;
}

export interface PeriodVerdictInput {
  entries: number;
  nights: number;
  showup: number | null;
  prevShowup: number | null;
  freeShare: number | null;
  converted: number;
  eligible: number;
}

/** La phrase qui ouvre Analyses › Guest list sur une période. */
export function periodVerdict(d: PeriodVerdictInput): Verdict {
  if (d.entries === 0) return { key: 'yc.gl.a.v.none', vars: {} };
  const conv = rate(d.converted, d.eligible);
  if (d.showup !== null && conv !== null) {
    return { key: 'yc.gl.a.v.full', vars: { n: d.entries, nights: d.nights, pct: d.showup, conv, converted: d.converted } };
  }
  if (d.showup !== null) return { key: 'yc.gl.a.v.showup', vars: { n: d.entries, nights: d.nights, pct: d.showup } };
  return { key: 'yc.gl.a.v.entries', vars: { n: d.entries, nights: d.nights } };
}

/** Valeurs du filtre Clients « Guest list » (`f.gl`, `_crm_filter_sql`). */
export const GL_FILTERS = ['any', 'only', 'loyal', 'conv', 'noshow'] as const;
export type GlFilter = (typeof GL_FILTERS)[number];
export const isGlFilter = (v: unknown): v is GlFilter => typeof v === 'string' && (GL_FILTERS as readonly string[]).includes(v);
