/**
 * Les blocs de l'éditeur CRM : palette (Contenu / Blocs Yuno, icônes du
 * prototype), textes par défaut d'un bloc neuf (vouvoiement), et le résumé
 * d'une ligne de l'onglet Structure.
 *
 * Les Blocs Yuno lisent la soirée reliée À L'ENVOI : tarifs, lieu, affiche et
 * lien de la billetterie connectée (get_external_event_live), artistes et
 * photos du line-up (get_event_lineup_live).
 */
import type { BlockType, EmailBlock } from '@/lib/email/types';

export type PaletteKey = BlockType;

export interface PaletteTile { k: PaletteKey; group: 'content' | 'yuno'; d: string }

/** Tracés du prototype (objet IC de yuno-mail.js). */
export const BLOCK_ICONS: Record<string, string> = {
  header: 'M3 3h18v6H3zM3 13h8v8H3zM15 13h6v8h-6z',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  cta: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM8 12h8',
  event: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  lineup: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  countdown: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  columns: 'M3 3h18v18H3zM12 3v18',
  social: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  divider: 'M3 12h18',
  spacer: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  tickets: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2',
  guestlist: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6v4H9zM9 12h6M9 16h6',
  table: 'M8 22h8M12 11v11M19 3H5l7 8z',
  html: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
  footer: 'M3 11h18v10H3zM7 11V7a5 5 0 0 1 10 0v4',
};

export const PALETTE: readonly PaletteTile[] = [
  { k: 'header', group: 'content', d: BLOCK_ICONS.header },
  { k: 'image', group: 'content', d: BLOCK_ICONS.image },
  { k: 'text', group: 'content', d: BLOCK_ICONS.text },
  { k: 'cta', group: 'content', d: BLOCK_ICONS.cta },
  { k: 'columns', group: 'content', d: BLOCK_ICONS.columns },
  { k: 'divider', group: 'content', d: BLOCK_ICONS.divider },
  { k: 'spacer', group: 'content', d: BLOCK_ICONS.spacer },
  { k: 'event', group: 'yuno', d: BLOCK_ICONS.event },
  { k: 'tickets', group: 'yuno', d: BLOCK_ICONS.tickets },
  { k: 'lineup', group: 'yuno', d: BLOCK_ICONS.lineup },
  { k: 'countdown', group: 'yuno', d: BLOCK_ICONS.countdown },
  { k: 'social', group: 'yuno', d: BLOCK_ICONS.social },
];

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Habille un bloc neuf : textes du design en vouvoiement, lien de la soirée
 * du brouillon sur un bouton (jamais yunoapp.eu, que le moteur met par défaut).
 */
export function decorateBlock(b: EmailBlock, t: T, nightUrl: string | null): EmailBlock {
  switch (b.type) {
    case 'image': return { ...b, label: t('yc.em.st.def.image'), h: 260 };
    case 'text': return { ...b, body: t('yc.em.st.def.text'), size: 16, px: 32 };
    case 'cta': return { ...b, label: t('yc.em.st.def.cta'), url: nightUrl ?? '', radius: 999 };
    case 'columns': return { ...b, left: { title: t('yc.em.st.def.colT'), body: t('yc.em.st.def.colB') }, right: { title: t('yc.em.st.def.colT'), body: t('yc.em.st.def.colB') }, px: 32 };
    case 'event': return { ...b, title: t('yc.em.st.def.event'), ctaLabel: t('yc.em.st.def.cta'), px: 32 };
    case 'tickets': return { ...b, ctaLabel: t('yc.em.st.def.tickets'), px: 32 };
    case 'countdown': return { ...b, label: t('yc.em.st.def.countdown') };
    case 'lineup': return { ...b, kicker: t('yc.em.st.def.lineup'), px: 32 };
    default: return b;
  }
}

/** Libellé (catalogue) d'un bloc posé. */
export function blockLabelKey(b: EmailBlock): string {
  return `yc.em.st.b.${b.type}`;
}

const plain = (s: string) => s.replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '').replace(/\*\*|__|~~/g, '').replace(/\s+/g, ' ').trim();

/** Résumé d'une ligne pour l'onglet Structure. */
export function blockSummary(b: EmailBlock, t: T, nightTitle: (id?: string) => string | null): string {
  switch (b.type) {
    case 'header': return b.venueName;
    case 'image': return b.label || '';
    case 'text': return plain(b.body || '').slice(0, 48);
    case 'cta': return b.label;
    case 'columns': return `${b.left.title} · ${b.right.title}`;
    case 'divider': return t('yc.em.st.b.divider.d');
    case 'spacer': return b.size.toUpperCase();
    case 'event': return nightTitle(b.eventId) ?? b.title;
    case 'tickets': return nightTitle(b.eventId) ?? t('yc.em.st.b.tickets.d');
    case 'countdown': return b.label;
    case 'lineup': return nightTitle(b.eventId) ?? t('yc.em.st.b.lineup.d');
    case 'social': return t('yc.em.st.b.social.d');
    default: return '';
  }
}
