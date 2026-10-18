/**
 * Yuno CRM — l'e-mail PRATIQUE aux détenteurs d'une soirée (S11, 18/10).
 * Doc : docs/designs/CRM_PRACTICAL_EMAIL.md.
 *
 * Un billet est un contrat d'accès à une soirée : ses informations pratiques
 * s'écrivent à chaque détenteur, sans accord marketing, tant que l'e-mail ne
 * vend rien. La règle vit côté serveur (guard_crm_practical_email,
 * _crm_practical_content_issues) ; ce module ne fait que composer le modèle de
 * départ et traduire les codes stables du serveur.
 */
import { makeBlock } from '@/lib/email/blocks';
import type { TemplateContent } from '@/lib/email/templates';
import type { EmailBlock } from '@/lib/email/types';
import { CRM_EMAIL_THEMES, type TemplateNight } from './emailTemplates';

/** Blocs permis dans un e-mail pratique (miroir de _crm_practical_content_issues). */
export const PRACTICAL_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'header', 'text', 'image', 'cta', 'columns', 'event', 'countdown', 'lineup', 'social', 'divider', 'spacer',
]);

export function isPracticalBlockType(type: string): boolean {
  return PRACTICAL_BLOCK_TYPES.has(type);
}

/** Codes de refus d'un CONTENU (issues du serveur) → clé de texte. */
const ISSUE_KEYS: Record<string, string> = {
  block_not_allowed: 'yc.pe.issue.block',
  other_event: 'yc.pe.issue.otherEvent',
  price_shown: 'yc.pe.issue.price',
  promo_words: 'yc.pe.issue.words',
  link_sales: 'yc.pe.issue.linkSales',
  link_other_event: 'yc.pe.issue.linkOther',
  link_ticketing: 'yc.pe.issue.linkTicketing',
  link_promo: 'yc.pe.issue.linkPromo',
  link_variable: 'yc.pe.issue.linkVariable',
};

export interface PracticalIssue {
  code: string;
  block?: string;
  type?: string;
  term?: string;
  url?: string;
  field?: 'subject' | 'preheader';
}

export function practicalIssueKey(code: string): string {
  return ISSUE_KEYS[code] ?? 'yc.pe.issue.generic';
}

/** Raison pour laquelle une soirée ne peut pas recevoir d'e-mail pratique → clé. */
export function practicalReasonKey(reason: string | null | undefined): string {
  switch (reason) {
    case 'role': return 'yc.pe.reason.role';
    case 'window': return 'yc.pe.reason.window';
    case 'limit': return 'yc.pe.reason.limit';
    case 'not_mirror': return 'yc.pe.reason.notMirror';
    default: return 'yc.pe.reason.generic';
  }
}

/**
 * Refus d'envoi ou de test lu dans une réponse (send-campaign ou erreur de la
 * base au passage en `scheduled`) → clé de texte, ou null si ce n'en est pas un.
 */
export function practicalRefusalKey(text: string): string | null {
  const m = /crm_practical_[a-z_]+/.exec(text);
  if (!m) return null;
  switch (m[0]) {
    case 'crm_practical_content': return 'yc.pe.err.content';
    case 'crm_practical_limit': return 'yc.pe.reason.limit';
    case 'crm_practical_window': return 'yc.pe.reason.window';
    case 'crm_practical_role': return 'yc.pe.reason.role';
    case 'crm_practical_event':
    case 'crm_practical_not_mirror': return 'yc.pe.reason.notMirror';
    case 'crm_practical_audience': return 'yc.pe.err.audience';
    case 'crm_practical_feature': return 'yc.pe.err.feature';
    default: return 'yc.pe.err.generic';
  }
}

/** Le jalon « à compléter » laissé dans le modèle, dans les trois langues. */
export const PRACTICAL_TODO = ['to fill in', 'à compléter', 'por completar'] as const;

/** Le pro a-t-il laissé un « à compléter » quelque part ? (vérification avant envoi). */
export function hasPracticalTodo(blocks: EmailBlock[], subject = ''): boolean {
  const hay = [subject, ...blocks.map((b) => JSON.stringify(b))].join(' ').toLowerCase();
  return PRACTICAL_TODO.some((w) => hay.includes(w));
}

export interface PracticalBuildCtx {
  venueName: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  night: TemplateNight;
}

type Loose = Record<string, unknown>;

/**
 * Le modèle de départ : un en-tête, le titre, ce qu'il faut savoir (avec des
 * « à compléter » que l'envoi refuse de laisser partir), la carte de la soirée
 * SANS prix (et sans bouton d'achat : le rendu pratique ne le dessine pas), le
 * line-up relu à l'envoi, puis comment répondre. Rien qui vende.
 */
export function buildPracticalEmail(ctx: PracticalBuildCtx): TemplateContent {
  const { venueName, t, night } = ctx;
  const b = (type: Parameters<typeof makeBlock>[0], patch: Loose = {}): EmailBlock =>
    ({ ...makeBlock(type, { venueName }), ...patch }) as EmailBlock;
  const todo = t('yc.pe.tpl.todo');
  return {
    type: 'informational',
    subject: t('yc.pe.tpl.subject', { title: night.title }),
    preheader: t('yc.pe.tpl.pre'),
    theme: { ...CRM_EMAIL_THEMES.clair },
    socialLinks: {},
    logoUrl: null,
    blocks: [
      b('header', { logoSize: 'md', py: 24 }),
      b('text', { body: t('yc.pe.tpl.kicker'), variant: 'kicker', size: 11, px: 32, py: 0 }),
      b('text', { body: t('yc.pe.tpl.title'), variant: 'headline', size: 28, px: 32, py: 8 }),
      b('text', { body: t('yc.pe.tpl.intro'), size: 16, px: 32, py: 10 }),
      b('text', { body: t('yc.pe.tpl.facts', { todo }), size: 16, px: 32, py: 10 }),
      b('event', {
        eventId: night.id, title: night.title, ctaLabel: '', price: false, venue: true,
        cover: true, layout: 'showcase', px: 32, py: 16,
      }),
      b('lineup', { eventId: night.id, kicker: t('yc.pe.tpl.lineup'), photos: true, align: 'left', extra: [], px: 32, py: 12 }),
      b('text', { body: t('yc.pe.tpl.reply'), size: 15, px: 32, py: 14 }),
      b('spacer', { size: 'sm' }),
    ],
  };
}
