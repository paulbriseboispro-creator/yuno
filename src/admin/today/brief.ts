/**
 * Le brief du jour (pur, testé) : les phrases qui ouvrent la page Aujourd'hui,
 * en clés de traduction + variables, calculées depuis la file, la veille et
 * les feux de santé. La page ne fait que les traduire.
 */
import type { Tone } from '@/admin/ui/tone';
import type { TodayItem } from './queue';

export interface Phrase { key: string; vars?: Record<string, string | number> }

export interface BriefInput {
  items: TodayItem[];
  /** Ventes d'hier (euros), `null` si inconnues. */
  yesterdaySales: number | null;
  /** Comptes pro créés hier, `null` si inconnus. */
  yesterdayAccounts: number | null;
  /** Feux de santé (nom lisible + ton). */
  lights: Array<{ label: string; tone: Tone }> | null;
  fmtEur: (v: number) => string;
}

export function openItems(items: TodayItem[]): TodayItem[] {
  return items.filter((i) => !i.mark);
}

export function brief({ items, yesterdaySales, yesterdayAccounts, lights, fmtEur }: BriefInput): Phrase[] {
  const open = openItems(items);
  const urgent = open.filter((i) => i.urgency === 1).length;
  const out: Phrase[] = [];
  if (open.length === 0) out.push({ key: 'adm.today.b.none' });
  else {
    const n = open.length;
    out.push({
      key: n === 1 ? 'adm.today.b.one' : 'adm.today.b.many',
      vars: { n },
    });
    out.push({ key: urgent === 0 ? 'adm.today.b.u0' : urgent === 1 ? 'adm.today.b.u1' : 'adm.today.b.uN', vars: { u: urgent } });
  }
  if (yesterdaySales != null || yesterdayAccounts != null) {
    const sales = yesterdaySales == null ? null : yesterdaySales > 0 ? fmtEur(yesterdaySales) : null;
    const acc = yesterdayAccounts ?? 0;
    out.push({
      key: sales ? 'adm.today.b.ySales' : 'adm.today.b.yNoSales',
      vars: { sales: sales ?? '' },
    });
    out.push({ key: acc === 0 ? 'adm.today.b.acc0' : acc === 1 ? 'adm.today.b.acc1' : 'adm.today.b.accN', vars: { n: acc } });
  }
  if (lights) {
    const bad = lights.filter((l) => l.tone === 'negative' || l.tone === 'warning').map((l) => l.label);
    out.push(bad.length === 0 ? { key: 'adm.today.b.allGood' } : { key: 'adm.today.b.watch', vars: { what: bad.join(', ') } });
  }
  return out;
}

/** La date d'hier (Paris), AAAA-MM-JJ. */
export function yesterdayKey(now = new Date()): string {
  return new Date(now.getTime() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

/** Clé de fiche d'un compte depuis le sujet d'une ligne de file, ou `null`. */
export function subjectAccountKey(kind: string | null, id: string | null): string | null {
  if (!id) return null;
  if (kind === 'venue') return `venue:${id}`;
  if (kind === 'crm' && /^(venue|org|agency):/.test(id)) return id;
  return null;
}
