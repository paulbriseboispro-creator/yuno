import type { BlockType, EmailBlock } from './types';

export interface MakeBlockCtx {
  venueName?: string;
  eventId?: string;
  logoUrl?: string;
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `b_${Math.random().toString(36).slice(2, 10)}`;
}

/** Défauts par type — la palette et les tests s'appuient dessus. */
export function makeBlock(type: BlockType, ctx: MakeBlockCtx = {}): EmailBlock {
  const id = uid();
  switch (type) {
    case 'header':
      return {
        id, type, venueName: ctx.venueName || 'LE SILO', showName: true,
        logoSize: 'md', logoShape: 'rounded', logoUrl: ctx.logoUrl,
      };
    case 'image':
      return { id, type, label: '', h: 210 };
    case 'text':
      return { id, type, body: '<p>Écris ton texte ici…</p>', size: 16, align: 'left' };
    case 'cta':
      return { id, type, label: 'Prendre mes billets', url: 'https://yunoapp.eu', align: 'center', radius: 8, full: false };
    case 'columns':
      return {
        id, type,
        left: { title: 'Colonne 1', body: 'Ton texte ici.' },
        right: { title: 'Colonne 2', body: 'Ton texte ici.' },
      };
    case 'event':
      return {
        id, type, eventId: ctx.eventId,
        title: 'Ta prochaine soirée', dateLabel: 'Samedi · 23:00',
        venueLabel: ctx.venueName || 'LE SILO', ctaLabel: 'Voir la soirée',
        cover: true, venue: true, price: false,
      };
    case 'tickets':
      return {
        id, type, eventId: ctx.eventId, live: true,
        rows: [
          { n: 'Early bird', s: 'Entrée avant minuit', p: '12 €', out: true },
          { n: 'Standard', s: 'Entrée toute la nuit', p: '18 €', out: false },
        ],
      };
    case 'table':
      return {
        id, type, eventId: ctx.eventId,
        title: 'Ta table t’attend', sub: 'Bottle service, entrée coupe-file',
        ctaLabel: 'Réserver une table', cond: 'VIP · Table',
      };
    case 'countdown':
      return { id, type, eventId: ctx.eventId, label: 'Ouverture des portes dans' };
    case 'social':
      return { id, type };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, size: 'md' };
    case 'html':
      return { id, type, code: '<!-- Ton HTML ici -->' };
  }
}

export function duplicateBlock(b: EmailBlock): EmailBlock {
  return { ...(JSON.parse(JSON.stringify(b)) as EmailBlock), id: uid() };
}

/** Slug d'adresse expéditeur — même règle que l'edge (email-sender-identity). */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'club';
}
