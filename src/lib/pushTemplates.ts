/**
 * Modèles de push MANUELS de la page Notifications (onglet Campagnes) : le pro
 * choisit un modèle, compose, cible et envoie (1 crédit par campagne marketing,
 * gratuit pour un message aux détenteurs d'une soirée).
 *
 * Les notifications AUTOMATIQUES des soirées ne vivent plus ici : c'est le
 * moteur de notifications Yuno (serveur, `_shared/push-engine.ts`, textes en
 * base dans `push_rule_templates`) qui les décide pour toutes les soirées.
 *
 * Constantes frontend (versionnées git, traduites via t()). Les strings
 * interpolées sont envoyées au serveur ; seul template_key est stocké sur la
 * campagne pour l'analytics. Variables ({venue}/{event}/{offer}/{count})
 * remplacées côté client par renderPushTemplate().
 */

// ─── Notifications MANUELLES ─────────────────────────────────────────────────

export type PushTemplateKey =
  | 'promotion'
  | 'flash_drinks'
  | 'last_tickets'
  | 'vip_tables'
  | 'guest_list_open'
  | 'contest'
  | 'custom';

export type PushTemplateVariable = 'venue' | 'event' | 'offer' | 'count';

export interface PushTemplate {
  key: PushTemplateKey;
  /** Clés i18n (pushTpl.*) du titre et du corps prérenseignés. */
  titleKey: string;
  bodyKey: string;
  /** Variables que l'UI doit demander (en plus de venue/event auto-remplies). */
  variables: PushTemplateVariable[];
  /** Audience présélectionnée dans l'étape ciblage. */
  suggestedAudience: 'event_tickets' | 'checked_in' | 'followers' | 'all_customers';
  /** True si le template n'a de sens qu'adossé à une soirée. */
  needsEvent: boolean;
  /** Emoji vignette de la grille de sélection. */
  emoji: string;
}

export const PUSH_TEMPLATES: PushTemplate[] = [
  {
    key: 'promotion',
    titleKey: 'pushTpl.promotion.title',
    bodyKey: 'pushTpl.promotion.body',
    variables: ['offer'],
    suggestedAudience: 'followers',
    needsEvent: false,
    emoji: '🎁',
  },
  {
    key: 'flash_drinks',
    titleKey: 'pushTpl.flashDrinks.title',
    bodyKey: 'pushTpl.flashDrinks.body',
    variables: ['offer'],
    suggestedAudience: 'checked_in',
    needsEvent: false,
    emoji: '🍸',
  },
  {
    key: 'last_tickets',
    titleKey: 'pushTpl.lastTickets.title',
    bodyKey: 'pushTpl.lastTickets.body',
    variables: ['count'],
    suggestedAudience: 'followers',
    needsEvent: true,
    emoji: '⏳',
  },
  {
    key: 'vip_tables',
    titleKey: 'pushTpl.vipTables.title',
    bodyKey: 'pushTpl.vipTables.body',
    variables: [],
    suggestedAudience: 'followers',
    needsEvent: true,
    emoji: '🍾',
  },
  {
    key: 'guest_list_open',
    titleKey: 'pushTpl.guestList.title',
    bodyKey: 'pushTpl.guestList.body',
    variables: [],
    suggestedAudience: 'followers',
    needsEvent: true,
    emoji: '📝',
  },
  {
    key: 'contest',
    titleKey: 'pushTpl.contest.title',
    bodyKey: 'pushTpl.contest.body',
    variables: [],
    suggestedAudience: 'checked_in',
    needsEvent: true,
    emoji: '🎰',
  },
  {
    key: 'custom',
    titleKey: 'pushTpl.custom.title',
    bodyKey: 'pushTpl.custom.body',
    variables: [],
    suggestedAudience: 'followers',
    needsEvent: false,
    emoji: '✏️',
  },
];

/** Remplace {venue}/{event}/{offer}/{count} par leurs valeurs. */
export function renderPushTemplate(
  text: string,
  values: Partial<Record<PushTemplateVariable, string>>,
): string {
  return text
    .replace(/\{venue\}/g, values.venue ?? '')
    .replace(/\{event\}/g, values.event ?? '')
    .replace(/\{offer\}/g, values.offer ?? '')
    .replace(/\{count\}/g, values.count ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
