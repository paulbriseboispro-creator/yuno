/**
 * Règles d'affichage de la suite E-mails : taux, écarts, libellé d'audience,
 * complétude d'un brouillon. Pures et testées.
 */
import type { ClientFilterDef } from '@/crm/data/clients';
import type { CrmAudience, EmailCampaignRow, EmailStats } from '@/crm/data/emails';

type T = (k: string, v?: Record<string, string | number>) => string;

export const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);
export const perK = (s: Pick<EmailStats, 'purchases' | 'n'>): number | null => (s.n > 0 ? (s.purchases / s.n) * 1000 : null);

/** Écart vs période d'avant : en % pour une quantité, en points pour un taux. */
export function delta(cur: number | null, prev: number | null, unit: 'pct' | 'pt'): { v: number; up: boolean } | null {
  if (cur === null || prev === null) return null;
  if (unit === 'pt') return { v: (cur - prev) * 100, up: cur >= prev };
  if (!prev) return null;
  return { v: ((cur - prev) / prev) * 100, up: cur >= prev };
}

function isCrm(a: unknown): a is CrmAudience {
  return !!a && typeof a === 'object' && (a as { kind?: string }).kind === 'crm';
}

/** Libellé d'une audience (« Habitués + Nouveaux »), ou null si aucune. */
export function audienceLabel(audiences: EmailCampaignRow['audiences'], t: T): string | null {
  const list = (Array.isArray(audiences) ? audiences : []).filter(isCrm);
  if (!list.length) return null;
  const names = list.map((a) => {
    if (a.label) return a.label;
    const def = (a.def ?? {}) as ClientFilterDef;
    const seg = def.seg ?? 'all';
    const plain = !def.q && !Object.keys(def.f ?? {}).length;
    if (seg === 'all' && plain) return t('yc.em.aud.all');
    if (seg !== 'all' && plain) return t(`yc.cli.seg.${seg}`);
    return t('yc.em.aud.custom');
  });
  return [...new Set(names)].join(' + ');
}

export type DraftGap = 'subject' | 'audience' | 'content';

/** Ce qu'il manque à un brouillon pour partir. */
export function draftGaps(c: Pick<EmailCampaignRow, 'subject' | 'audiences' | 'has_content'>): DraftGap[] {
  const gaps: DraftGap[] = [];
  if (!c.subject || !c.subject.trim()) gaps.push('subject');
  if (!(Array.isArray(c.audiences) ? c.audiences : []).some(isCrm)) gaps.push('audience');
  if (!c.has_content) gaps.push('content');
  return gaps;
}

/** « Line-up Techno Ni… » : un nom tronqué pour un axe de graphique. */
export function shortName(s: string | null | undefined, max = 20): string {
  const v = (s ?? '').trim();
  return v.length > max ? `${v.slice(0, max - 2).trimEnd()}…` : v;
}

/** Retire les traceurs Yuno d'un lien pour l'afficher. */
export function cleanLink(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k === 'yc' || k.startsWith('utm_')) u.searchParams.delete(k);
    const s = `${u.host}${u.pathname}${u.search}`;
    return s.replace(/\/$/, '');
  } catch { return url; }
}
