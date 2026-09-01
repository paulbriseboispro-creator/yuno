// ─────────────────────────────────────────────────────────────────────────────
// Modèles Yuno prêts à l'emploi — le point de départ quand le pro n'a encore
// enregistré aucun modèle à lui. Ce sont des CONSTRUCTIONS, pas des lignes en
// base : rien à semer, rien à migrer, et la copie suit les 3 langues.
//
// Même contrat que les modèles utilisateur : aucun `eventId`. Les blocs Yuno
// se relient à la soirée choisie au moment de créer la campagne.
// ─────────────────────────────────────────────────────────────────────────────

import { makeBlock } from './blocks';
import { DEFAULT_STUDIO_THEME } from './themes';
import type { TemplateContent } from './templates';
import type { EmailBlock, EmailTheme } from './types';

export type StarterKey = 'invitation' | 'last_call' | 'vip_tables' | 'announcement';

export interface StarterMeta {
  key: StarterKey;
  nameKey: string;
  descKey: string;
}

export const STARTER_TEMPLATES: readonly StarterMeta[] = [
  { key: 'invitation', nameKey: 'studio.starter.invitation.name', descKey: 'studio.starter.invitation.desc' },
  { key: 'last_call', nameKey: 'studio.starter.last_call.name', descKey: 'studio.starter.last_call.desc' },
  { key: 'vip_tables', nameKey: 'studio.starter.vip_tables.name', descKey: 'studio.starter.vip_tables.desc' },
  { key: 'announcement', nameKey: 'studio.starter.announcement.name', descKey: 'studio.starter.announcement.desc' },
];

export interface StarterCtx {
  venueName: string;
  theme?: EmailTheme;
  t: (key: string) => string;
}

type Patch<T> = Partial<T> & Record<string, unknown>;

function block(type: Parameters<typeof makeBlock>[0], venueName: string, patch: Patch<EmailBlock> = {}): EmailBlock {
  return { ...makeBlock(type, { venueName }), ...patch } as EmailBlock;
}

/**
 * Construit un modèle de départ. Aucun bloc « Réseaux » n'est posé : le pied
 * de page les porte déjà, et les doubler est justement ce que la checklist
 * pré-envoi signale.
 */
export function buildStarter(key: StarterKey, ctx: StarterCtx): TemplateContent {
  const { venueName, t } = ctx;
  const theme = ctx.theme || DEFAULT_STUDIO_THEME;
  const k = (suffix: string) => t(`studio.starter.${key}.${suffix}`);
  const base = {
    type: 'promotional' as const,
    subject: k('subject'),
    preheader: k('preheader'),
    theme: { ...theme },
    socialLinks: {},
    logoUrl: null,
  };

  switch (key) {
    case 'invitation':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          block('event', venueName, { title: k('eventTitle'), ctaLabel: k('eventCta'), price: true }),
          block('tickets', venueName, { live: true }),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    case 'last_call':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1'), align: 'center' }),
          block('countdown', venueName, { label: k('countdownLabel') }),
          block('tickets', venueName, { live: true }),
          block('text', venueName, { body: k('t2'), size: 14, align: 'center' }),
        ],
      };

    case 'vip_tables':
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('text', venueName, { body: k('t1') }),
          // cond effacée : une campagne qui VEND des tables doit être vue par
          // tout le monde, pas seulement par ceux qui en ont déjà réservé une.
          block('table', venueName, {
            cond: null, kicker: k('tableKicker'), title: k('tableTitle'),
            sub: k('tableSub'), ctaLabel: k('tableCta'),
          }),
          block('divider', venueName),
          block('text', venueName, { body: k('t2'), size: 14 }),
        ],
      };

    case 'announcement':
    default:
      return {
        ...base,
        blocks: [
          block('header', venueName),
          block('image', venueName, { label: k('imgAlt'), h: 240 }),
          block('text', venueName, { body: k('t1') }),
          block('cta', venueName, { label: k('cta'), align: 'center' }),
        ],
      };
  }
}
