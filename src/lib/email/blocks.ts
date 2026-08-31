import type { BlockCond, BlockType, EmailBlock } from './types';

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

/** Défauts par type — alignés sur make() du prototype claude.design. */
export function makeBlock(type: BlockType, ctx: MakeBlockCtx = {}): EmailBlock {
  const id = uid();
  switch (type) {
    case 'header':
      return {
        id, type, venueName: ctx.venueName || 'LE SILO', showName: true,
        logoSize: 'md', logoShape: 'rounded', logoUrl: ctx.logoUrl,
      };
    case 'image':
      return { id, type, label: 'visuel de soirée — 1200×690', h: 210 };
    case 'text':
      return { id, type, body: 'Écris ton message ici. Utilise {{prénom}} pour personnaliser.', size: 16, align: 'left' };
    case 'cta':
      return { id, type, label: 'Réserver ma place', url: 'https://yunoapp.eu', align: 'center', radius: 8, full: false };
    case 'columns':
      return {
        id, type,
        left: { title: 'Warm-up', body: '23h30 — 01h00' },
        right: { title: 'Peak time', body: '01h00 — 04h00' },
      };
    case 'event':
      return {
        id, type, eventId: ctx.eventId,
        title: 'Ta prochaine soirée', dateLabel: 'Vendredi · 23h30 → 06h00',
        venueLabel: ctx.venueName || 'LE SILO', ctaLabel: "Voir l'événement",
        cover: true, venue: true, price: false,
      };
    case 'tickets':
      return {
        id, type, eventId: ctx.eventId, live: true,
        rows: [
          { n: 'Early bird', s: 'épuisé', p: '12 €', out: true },
          { n: 'Prévente 1', s: 'il reste 84 places', p: '18 €', out: false },
          { n: 'Sur place', s: 'selon jauge', p: '25 €', out: false },
        ],
      };
    case 'table':
      return {
        id, type, eventId: ctx.eventId,
        kicker: 'Bottle service',
        title: 'Ta table t’attend', sub: 'Bottle service, entrée coupe-file, carré réservé.',
        ctaLabel: 'Réserver une table', cond: 'vip_table',
      };
    case 'countdown':
      return { id, type, eventId: ctx.eventId, label: 'Ouverture de la billetterie' };
    case 'social':
      return { id, type };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, size: 'md' };
    case 'html':
      return { id, type, code: '<!-- colle ton HTML ici -->' };
  }
}

export function duplicateBlock(b: EmailBlock): EmailBlock {
  return { ...(JSON.parse(JSON.stringify(b)) as EmailBlock), id: uid() };
}

/** Libellés des règles de visibilité (prototype : onglet Dynamique). */
export const BLOCK_COND_LABELS: Record<BlockCond, string> = {
  vip_table: 'VIP · Table',
  new_subscribers: 'Nouveaux abonnés',
  buyers: 'A déjà acheté',
};

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
