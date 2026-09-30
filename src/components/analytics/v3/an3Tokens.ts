/**
 * Analytics v3 — jetons (couleurs, hauteurs, style d'infobulle). Séparés des
 * composants pour le fast refresh.
 */
import type { CSSProperties } from 'react';

export const A3 = {
  accent: 'var(--acc-5b9cff)',
  accentSoft: 'rgba(91,156,255,0.22)',
  accentFaint: 'rgba(91,156,255,0.10)',
  ref: 'rgb(var(--ink)/0.32)',
  refSoft: 'rgb(var(--ink)/0.10)',
  good: 'var(--acc-34d399)',
  warn: 'var(--acc-fbbf24)',
  bad: 'var(--acc-ff5c63)',
  deltaUp: 'var(--acc-5b9cff)',
  deltaDown: 'var(--acc-f97316)',
  t1: 'rgb(var(--ink)/var(--ink-a96,0.96))',
  t2: 'rgb(var(--ink)/var(--ink-a58,0.58))',
  t3: 'rgb(var(--ink)/var(--ink-a36,0.36))',
  border: 'rgb(var(--ink)/0.085)',
  track: 'rgb(var(--ink)/0.07)',
  faint: 'rgb(var(--ink)/0.045)',
  cardBg: 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)',
  shadow: '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))',
  pageBg: 'var(--sf-000000)',
  axis: 'rgb(var(--ink)/0.40)',
  grid: 'rgb(var(--ink)/0.08)',
} as const;

/** Hauteurs (spec §3.13) : 180 px pour une carte, 320 px pour le graphe principal. */
export const CHART_H = 180;
export const MAIN_CHART_H = 320;

/** Style d'infobulle recharts commun. */
export const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--sf-141416)', border: `1px solid ${A3.border}`, borderRadius: 12, padding: '8px 10px',
  color: A3.t1, fontSize: 12, boxShadow: '0 12px 30px -16px rgb(0 0 0 / .6)',
};
