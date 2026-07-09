/**
 * Templates de push pour le tab "Push notifications" des clubs.
 *
 * DEUX familles bien séparées :
 *   • PUSH_TEMPLATES    → notifications MANUELLES : l'owner compose + envoie
 *                         (promo, happy hour, dernières places, VIP, guest list…).
 *   • PUSH_AUTOMATIONS  → notifications AUTO : l'owner active un toggle, Yuno
 *                         envoie au bon moment (avant / pendant / après la soirée,
 *                         + scarcity billetterie). Le texte réel + l'envoi vivent
 *                         côté serveur (_shared/push-automations.ts) ; ici on ne
 *                         garde que les métadonnées pour l'UI + l'aperçu.
 *
 * Constantes frontend (versionnées git, traduites via t()). Pour les manuelles,
 * les strings interpolées sont envoyées au serveur ; seul template_key est
 * stocké sur la campagne pour l'analytics. Variables ({venue}/{event}/{offer}/
 * {count}) remplacées côté client par renderPushTemplate().
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

// ─── Notifications AUTOMATIQUES ──────────────────────────────────────────────

export type PushAutomationKey =
  | 'reminder_day_of'
  | 'event_live'
  | 'thank_you'
  | 'almost_sold_out';

export interface PushAutomation {
  key: PushAutomationKey;
  emoji: string;
  /** Clés i18n (pushTpl.*) réutilisées pour l'aperçu du message. */
  titleKey: string;
  bodyKey: string;
  /** Variables interpolées dans l'aperçu. */
  variables: PushTemplateVariable[];
  /** Clé i18n de l'audience ciblée (affichage carte). */
  audienceKey: string;
}

/**
 * Ordre chronologique dans le cycle de vie d'une soirée : avant → pendant →
 * après, puis la scarcity billetterie. Le dispatcher serveur porte la même
 * liste de clés (_shared/push-automations.ts).
 */
export const PUSH_AUTOMATIONS: PushAutomation[] = [
  {
    key: 'reminder_day_of',
    emoji: '🎟️',
    titleKey: 'pushTpl.reminder.title',
    bodyKey: 'pushTpl.reminder.body',
    variables: ['event', 'venue'],
    audienceKey: 'ownerPush.audEventTickets',
  },
  {
    key: 'event_live',
    emoji: '🔥',
    titleKey: 'pushTpl.eventLive.title',
    bodyKey: 'pushTpl.eventLive.body',
    variables: ['event', 'venue'],
    audienceKey: 'ownerPush.audEventTickets',
  },
  {
    key: 'thank_you',
    emoji: '🖤',
    titleKey: 'pushTpl.thankYou.title',
    bodyKey: 'pushTpl.thankYou.body',
    variables: ['venue'],
    audienceKey: 'ownerPush.audCheckedIn',
  },
  {
    key: 'almost_sold_out',
    emoji: '⚡',
    titleKey: 'pushTpl.almostSoldOut.title',
    bodyKey: 'pushTpl.almostSoldOut.body',
    variables: ['event', 'venue'],
    audienceKey: 'ownerPush.audFollowers',
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
