import type { FavoriteType } from '@/hooks/useFavorites';

/* ── Design tokens (aligned with Yuno DS: index.css variables) ── */
export const D = {
  bg:         '#0A0A0A',     // --yuno-black
  surface:    '#141414',     // --yuno-card
  surface2:   '#1B1B1E',     // --yuno-card-2
  elevated:   '#222226',     // --yuno-elev
  input:      '#1F1F22',     // --yuno-input
  line:       'rgba(255,255,255,.08)',   // --border-subtle
  lineStrong: 'rgba(255,255,255,.14)',   // --border-strong
  muted:      '#9A9A9A',     // --yuno-gray-2
  faint:      '#5A5A5E',     // --yuno-gray-3
  red:        '#E8192C',     // --yuno-red
  redHover:   '#FF2438',     // --yuno-red-hover
  redSoft:    'rgba(232,25,44,.14)',     // --yuno-red-soft
  redDim:     'rgba(232,25,44,.10)',     // --yuno-red-dim
  redText:    '#FF9AA4',     // rouge lisible sur fond sombre (pills genre)
  violet:     '#A78BFA',
  violetSoft: 'rgba(167,139,250,.16)',
  // Les deux familles du DS public, chargées dans index.html. Écrites en dur et
  // pas via `var(--yuno-mono)` : cette variable n'existe nulle part dans index.css,
  // donc l'ancienne page retombait silencieusement sur le mono système et perdait
  // la signature nightlife (DESIGN_SYSTEM_PUBLIC.md §3.4).
  mono:       "'JetBrains Mono', ui-monospace, monospace",
  display:    "'Space Grotesk', system-ui, sans-serif",
} as const;

/** Derive a stable hue (0-359) from any string. */
export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h % 360;
}

/** Coloured glow background — fallback visual when an item has no artwork. */
export function glowStyle(hue: number): React.CSSProperties {
  const h2 = (hue + 38) % 360;
  return {
    backgroundImage: [
      `radial-gradient(115% 85% at 28% 12%, hsl(${hue} 85% 58% / .62), transparent 55%)`,
      `radial-gradient(120% 95% at 88% 92%, hsl(${h2} 80% 48% / .42), transparent 52%)`,
      `repeating-linear-gradient(125deg, rgba(255,255,255,.03) 0 2px, transparent 2px 9px)`,
      `linear-gradient(155deg, #17171c, #0b0b0e)`,
    ].join(','),
  };
}

/* ── Modèle unifié de la mosaïque ──
   Les cinq familles de favoris (club, soirée, DJ, boisson, organisateur) vivent
   dans des tables différentes et n'ont ni les mêmes champs ni la même sémantique
   (cœur vs cloche). La grille, elle, doit les mélanger dans un seul flux : on les
   aplatit donc en un seul type porteur de PRIMITIVES DE PRÉSENTATION (un tag de
   titre, un tag de pied, une ligne meta) plutôt que de champs métier. La carte
   n'a alors aucun `switch` sur le genre, et ajouter une famille = produire un
   FavItem de plus. */
export type FavKind = 'club' | 'event' | 'dj' | 'drink' | 'organizer';

/** Filtre actif de la mosaïque. `all` = le mélange complet. */
export type Filter = 'all' | 'clubs' | 'events' | 'djs' | 'drinks' | 'organizers';

export const FILTER_OF_KIND: Record<FavKind, Exclude<Filter, 'all'>> = {
  club: 'clubs',
  event: 'events',
  dj: 'djs',
  drink: 'drinks',
  organizer: 'organizers',
};

export interface FavItem {
  /** Clé React stable — `${kind}:${id}` (les ids sont des UUID de tables distinctes). */
  key: string;
  kind: FavKind;
  id: string;
  title: string;
  /** Toujours rendue en 1:1 plein cadre (object-fit: cover) sur fond noir uni.
      Pas de mode `contain` : logos et bouteilles posés au centre laissaient voir
      le glow coloré autour de l'image (fond « bizarre »). Le glow ne sert plus
      que de repli quand il n'y a AUCUNE image. */
  imageUrl?: string;
  /** Prix, collé au titre (boissons). Court par nature — « 8€ » ne vole pas de place au nom. */
  price?: string;
  /** Pill de genre, sur la ligne du bas. Jamais collée au titre : sur une carte de
      170px, « Reggaeton » à côté de « Sala Bacano » rognait le nom du club, or le
      nom est ce qu'on cherche et le genre ce qu'on survole. */
  footerTag?: string;
  /** Ligne mono du bas : « 3 soirées à venir », « VEN 17 JUIL · House »… */
  meta?: string;
  /** `accent` passe la meta en rouge — réservé aux signaux vivants (soirées à venir). */
  metaTone?: 'default' | 'accent';
  isAffiliate?: boolean;
  /** Type pour <FavoriteButton>. Absent = organisateur (table de follow dédiée). */
  favType?: FavoriteType;
  onOpen?: () => void;
  /** Haystack minuscule pour la recherche (titre + club + genre + ville). */
  search: string;
}

/* Ordre « aléatoire » mais STABLE : dérivé de l'id, jamais d'un vrai hasard.
   Un Math.random() reclasserait la mosaïque à chaque re-render — or `favorites`
   change dès qu'un cœur est tapé, donc les cartes sauteraient sous le pouce au
   moment précis où l'on interagit avec elles. Ici le mélange est calculé une fois
   pour toutes par item : varié à l'œil, immobile à l'usage. */
export function shuffleSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** 8400 → « 8.4K ». Les compteurs d'abonnés doivent tenir sur une carte de 170px. */
export function formatCompact(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(n);
  }
}
