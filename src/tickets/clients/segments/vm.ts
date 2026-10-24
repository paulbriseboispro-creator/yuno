/**
 * Une ligne de segment prête à dessiner : la donnée serveur + son nom, sa
 * règle en phrase, sa couleur et le sens de sa croissance.
 */
import type { SegPeriod, SegmentRow } from '@/tickets/clients/data/segments';

export interface SegVM extends SegmentRow {
  label: string;
  rule: string;
  color: string;
  /** Croître est une bonne nouvelle (faux pour les endormis, habitués qui s'éloignent…). */
  good: boolean;
  /** Variation sur la période (null : pas encore d'historique). */
  delta: number | null;
  /** L'historique de la période est en cours de calcul (dates repères manquantes). */
  pending?: boolean;
}

/** « ▲ 310 sur 30 jours », vert si croître est une bonne nouvelle, ambre sinon. */
export function deltaText(s: SegVM, t: (k: string, v?: Record<string, string | number>) => string, n: (v: number) => string, period: SegPeriod) {
  if (s.delta === null) return { txt: s.pending ? '…' : '—', fg: 'var(--ya-sand-500)' };
  if (s.delta === 0) return { txt: t('ya.seg.d.stable'), fg: 'var(--ya-sand-500)' };
  const txt = t(s.delta > 0 ? 'ya.seg.d.up' : 'ya.seg.d.down', { n: n(Math.abs(s.delta)), on: t(`ya.seg.on.${period}`) });
  return { txt, fg: s.delta > 0 ? (s.good ? 'var(--ya-green-700)' : 'var(--ya-amber-700)') : 'var(--ya-sand-500)' };
}
