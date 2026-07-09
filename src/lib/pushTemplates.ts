/**
 * Templates de push prédéfinis pour le tab "Push" des clubs.
 * Constantes frontend (versionnées git, traduites via t()) — les strings
 * finales interpolées sont envoyées au serveur, seul template_key est stocké
 * sur la campagne pour l'analytics.
 *
 * Variables d'interpolation ({venue}, {event}, {offer}, {count}) remplacées
 * côté client par renderPushTemplate().
 */

export type PushTemplateKey =
  | 'promotion'
  | 'contest'
  | 'last_tickets'
  | 'event_live'
  | 'thank_you'
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
    key: 'contest',
    titleKey: 'pushTpl.contest.title',
    bodyKey: 'pushTpl.contest.body',
    variables: [],
    suggestedAudience: 'checked_in',
    needsEvent: true,
    emoji: '🎰',
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
    key: 'event_live',
    titleKey: 'pushTpl.eventLive.title',
    bodyKey: 'pushTpl.eventLive.body',
    variables: [],
    suggestedAudience: 'event_tickets',
    needsEvent: true,
    emoji: '🔥',
  },
  {
    key: 'thank_you',
    titleKey: 'pushTpl.thankYou.title',
    bodyKey: 'pushTpl.thankYou.body',
    variables: [],
    suggestedAudience: 'checked_in',
    needsEvent: true,
    emoji: '🖤',
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
