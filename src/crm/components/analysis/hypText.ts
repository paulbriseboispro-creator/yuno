/**
 * Les phrases de l'analyse client : la preuve d'une hypothèse (un FAIT), le
 * statut de sa famille en chiffres, et la pastille du statut. Partagé par la
 * fiche client, Analyses › Communauté › Ce qui fait venir et le tiroir d'une
 * soirée. Aucune phrase n'affirme un motif (« vient pour », « aime »…).
 * Les composants (pastille, barres de force) vivent dans HypBits.tsx.
 */
import type { useCrmT } from '@/crm/i18n';
import { displayStatus, evidenceKey, rateOrNull } from '@/crm/lib/analysis';
import type { AnPrior, AnStatus, AnAvailability, AnKind, Hypothesis } from '@/crm/lib/analysis';

type T = ReturnType<typeof useCrmT>;

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Nom d'un jour (1 = lundi … 7 = dimanche) dans la langue de l'écran. */
export function weekdayName(isodow: number, locale: string): string {
  const d = new Date(2024, 0, Math.min(7, Math.max(1, Math.round(isodow)))); // 1er janvier 2024 = lundi
  return d.toLocaleDateString(locale, { weekday: 'long' });
}

/** Libellé d'une source d'arrivée (`_crm_ticket_source`, plus `gl`). */
export function sourceName(code: string | null | undefined, T: T): string {
  if (!code) return '—';
  return code === 'gl' ? T.t('yc.why.src.gl') : T.t(`yc.ana.src.${code}`);
}

function countryName(code: string | null | undefined, lang: string): string {
  if (!code) return '—';
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) ?? code; } catch { return code; }
}

/** La preuve d'une hypothèse : « A vu Malaa 2 fois, à 2 séries différentes. » */
export function evidenceText(h: Pick<Hypothesis, 'k' | 'p'>, T: T): string {
  const p = (h.p ?? {}) as Record<string, string | number | null | undefined>;
  const v: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(p)) if (x !== null && x !== undefined) v[k] = typeof x === 'number' ? T.n(x) : x;
  if (typeof p.genre === 'string') v.genre = cap(p.genre);
  if (h.k === 'slot.dominant' && typeof p.value === 'string') v.value = T.t(`yc.why.slot.${p.value}`);
  if (h.k === 'weekday.dominant' && p.value !== undefined) v.value = weekdayName(Number(p.value), T.locale);
  if (h.k === 'format.dominant' && typeof p.value === 'string') v.value = cap(p.value);
  if (h.k === 'channel.first') v.src = sourceName(typeof p.src === 'string' ? p.src : null, T);
  if (h.k === 'passing.foreign') v.country = countryName(typeof p.country === 'string' ? p.country : null, T.lang);
  return T.t(`yc.why.ev.${evidenceKey(h.k, p)}`, v);
}

export interface StatusLike {
  status?: AnStatus | null;
  availability?: AnAvailability | null;
  kind?: AnKind | null;
  o?: number | null; e?: number | null; n?: number | null;
  direction?: 'more' | 'less' | null;
  detail?: { r1?: number | null; r0?: number | null; n0?: number | null } | null;
  prior?: AnPrior | null;
}

/** Le statut d'une famille, dit en chiffres (une ligne). */
export function statusDetail(f: StatusLike, T: T, minN = 30): string {
  const ds = displayStatus(f);
  if (ds === 'off') return T.t(f.availability === 'uniform' ? 'yc.why.det.uniform' : 'yc.why.det.unavailable');
  if (ds === 'prior_only') return T.t('yc.why.det.prior', { k: T.n(f.prior?.accounts ?? 0) });
  const o = T.n(Math.round(Number(f.o ?? 0))), e = T.n(Math.round(Number(f.e ?? 0))), n = T.n(Number(f.n ?? 0));
  if (ds === 'untested') {
    return f.status === 'inconclusive' ? T.t('yc.why.det.inconclusive', { o, e }) : T.t('yc.why.det.untested', { n, min: T.n(minN) });
  }
  if (f.kind === 'return') {
    const r1 = f.detail?.r1, r0 = f.detail?.r0;
    const fmt = (r: number | null | undefined) => (r === null || r === undefined ? '—' : T.pct(r * 100));
    const key = Math.abs(Number(f.o ?? 0) / Math.max(1e-9, Number(f.e ?? 0)) - 1) < 0.1 ? 'same' : f.direction === 'less' ? 'less' : 'more';
    return T.t(`yc.why.det.return.${key}`, { r1: fmt(r1), r0: fmt(r0), n });
  }
  return T.t(f.kind === 'behaviour' ? 'yc.why.det.behaviour' : 'yc.why.det.affinity', { o, e, n });
}

/** « 41 % » à partir de 10 personnes, sinon « 4 / 9 ». */
export function rateText(num: number, den: number, T: T, min = 10): string {
  const r = rateOrNull(num, den, min);
  return r === null ? `${T.n(num)} / ${T.n(den)}` : T.pct(r * 100);
}

