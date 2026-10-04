/**
 * Règles de l'écran Analyse des e-mails : mesures par campagne, tendance,
 * meilleur créneau, types d'e-mails, longueur d'objet, santé de l'envoi.
 * Les chiffres viennent de `crm_email_analysis` ; ces fonctions ne font que
 * les lire, et se taisent quand la base est trop mince pour conclure.
 */
import type { EmailAnalysis } from '@/crm/data/emails';

export type Campaign = EmailAnalysis['campaigns'][number];
export type Metric = 'or' | 'cr' | 'bp';

/** Ouvertures et clics sur les reçus ; achats pour 1 000 e-mails envoyés. */
export function metricOf(c: Campaign, m: Metric): number {
  if (m === 'bp') return c.n > 0 ? (c.purchases / c.n) * 1000 : 0;
  if (c.received <= 0) return 0;
  return (m === 'or' ? c.opened : c.clicked) / c.received;
}

/**
 * Écart relatif entre la moitié récente et la moitié ancienne des campagnes
 * (0,12 = +12 %). Rien sous 4 campagnes ou sur une base nulle.
 */
export function trend(vals: number[]): number | null {
  if (vals.length < 4) return null;
  const half = Math.floor(vals.length / 2);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a1 = avg(vals.slice(0, half));
  const a2 = avg(vals.slice(half));
  if (a1 <= 0) return null;
  return (a2 - a1) / a1;
}

/** En dessous, un créneau est montré mais pas retenu comme « meilleur ». */
export const SLOT_MIN = 100;

export interface Slot { d: number; h: number; n: number; clicked: number; rate: number; low: boolean }

/** Grille complète 7 jours × 8 tranches de 2 h (8 h → 22 h), cases vides à null. */
export function slotGrid(grid: EmailAnalysis['grid'], min = SLOT_MIN): (Slot | null)[] {
  const out: (Slot | null)[] = Array.from({ length: 56 }, () => null);
  for (const g of grid) {
    if (g.d < 0 || g.d > 6 || g.h < 0 || g.h > 7 || g.n <= 0) continue;
    out[g.d * 8 + g.h] = { d: g.d, h: g.h, n: g.n, clicked: g.clicked, rate: g.clicked / g.n, low: g.n < min };
  }
  return out;
}

/** Le créneau qui fait le plus cliquer parmi ceux assez fournis, et la moyenne pondérée. */
export function bestSlot(grid: EmailAnalysis['grid'], min = SLOT_MIN): { best: Slot | null; avg: number | null } {
  const cells = slotGrid(grid, min).filter((x): x is Slot => !!x);
  const n = cells.reduce((s, x) => s + x.n, 0);
  const avg = n > 0 ? cells.reduce((s, x) => s + x.clicked, 0) / n : null;
  const best = cells.filter((x) => !x.low).sort((a, b) => b.rate - a.rate || b.n - a.n)[0] ?? null;
  return { best, avg };
}

export interface KindStat { kind: string; campaigns: number; perK: number; open: number; click: number }

/** Résultats par modèle de départ ; une campagne sans modèle compte comme « autre ». */
export function kindStats(campaigns: Campaign[]): KindStat[] {
  const by = new Map<string, Campaign[]>();
  for (const c of campaigns) {
    const k = c.kind || 'autre';
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return [...by.entries()].map(([kind, list]) => {
    const n = list.reduce((s, c) => s + c.n, 0);
    const rec = list.reduce((s, c) => s + c.received, 0);
    return {
      kind,
      campaigns: list.length,
      perK: n > 0 ? (list.reduce((s, c) => s + c.purchases, 0) / n) * 1000 : 0,
      open: rec > 0 ? list.reduce((s, c) => s + c.opened, 0) / rec : 0,
      click: rec > 0 ? list.reduce((s, c) => s + c.clicked, 0) / rec : 0,
    };
  }).sort((a, b) => b.perK - a.perK);
}

/** Les quatre longueurs d'objet (moins de 30, 30-45, 46-62, plus de 62 caractères). */
export function subjectBuckets(subjects: EmailAnalysis['subjects']): ({ rate: number; received: number } | null)[] {
  return [0, 1, 2, 3].map((b) => {
    const s = subjects.find((x) => x.b === b);
    return s && s.received > 0 ? { rate: s.opened / s.received, received: s.received } : null;
  });
}

/** Ouverture des objets au prénom ({{…}}) contre les autres ; null s'il manque un côté. */
export function personalOpen(campaigns: Campaign[]): { with: number; without: number } | null {
  const rate = (xs: Campaign[]) => {
    const rec = xs.reduce((s, c) => s + c.received, 0);
    return rec > 0 ? xs.reduce((s, c) => s + c.opened, 0) / rec : null;
  };
  const yes = rate(campaigns.filter((c) => (c.subject ?? '').includes('{{')));
  const no = rate(campaigns.filter((c) => !(c.subject ?? '').includes('{{')));
  return yes === null || no === null ? null : { with: yes, without: no };
}

/** Seuils de la santé d'envoi : au-delà, l'indicateur est « à surveiller ». */
export const HEALTH_LIMITS = { bounced: 0.03, unsub: 0.005, spam: 0.001 } as const;
