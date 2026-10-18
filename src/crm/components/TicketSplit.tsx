/**
 * « 52 payants · 704 entrées gratuites · 12 en guest list » : la composition
 * des places d'une soirée ou d'une période (décision D4 de Paul, 17/10,
 * migration 20261020200000). Un billet à 0 € n'est jamais présenté comme une
 * vente : partout où des places se comptent, payants et gratuits côte à côte.
 * Rien ne s'affiche tant que le serveur ne rend pas la répartition.
 */
import type { CSSProperties } from 'react';
import { useCrmT } from '@/crm/i18n';

export function TicketSplit({ paid, free, inv, mult = 1, style, strong = 'var(--ink)' }: {
  paid: number | null | undefined;
  free: number | null | undefined;
  /** Invitations Shotgun (la guest list) : montrées seulement s'il y en a. */
  inv?: number | null;
  /** Coefficient d'animation des chiffres (0 → 1). */
  mult?: number;
  style?: CSSProperties;
  /** Couleur des nombres (sur fond sombre : blanc). */
  strong?: string;
}) {
  const { tp, n } = useCrmT();
  if (paid === null || paid === undefined || free === null || free === undefined) return null;
  // Rien de pris : pas de « 0 payant · 0 entrée gratuite ».
  if (paid + free + (inv ?? 0) === 0) return null;
  const part = (v: number, key: string) => (
    <span style={{ whiteSpace: 'nowrap' }}>
      <b style={{ fontWeight: 600, color: strong, fontVariantNumeric: 'tabular-nums' }}>{n(Math.round(v * mult))}</b> {tp(key, v)}
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px', fontSize: 13.5, color: 'var(--sand-500)', ...style }}>
      {part(paid, 'yc.tk.paid')}
      <span aria-hidden>·</span>
      {part(free, 'yc.tk.free')}
      {inv ? <><span aria-hidden>·</span>{part(inv, 'yc.tk.inv')}</> : null}
    </span>
  );
}
