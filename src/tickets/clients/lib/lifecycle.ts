/**
 * Les cinq cycles de vie d'un client (règle serveur : _tix_people_build, la
 * même que le CRM) et leur dessin aux couleurs de Yuno Tickets (variables
 * `--ya-*`). Initiales, nom et « il y a … » sont ceux du CRM.
 */
import type { Lifecycle } from '@/tickets/clients/data/clients';

export { LIFECYCLES, initials, fullName, relDays } from '@/crm/lib/lifecycle';

export const LIFECYCLE_COLOR: Record<Lifecycle, string> = {
  hab: 'var(--ya-red-500)',
  occ: 'var(--ya-tangerine-500)',
  nou: 'var(--ya-red-200)',
  end: 'var(--ya-sand-300)',
  none: 'var(--ya-sand-100)',
};

/** Fond et encre de l'avatar d'un client, selon son cycle de vie. */
export const LIFECYCLE_AVATAR: Record<Lifecycle, [string, string]> = {
  hab: ['var(--ya-gradient-brand)', '#fff'],
  occ: ['var(--ya-red-100)', 'var(--ya-red-700)'],
  nou: ['var(--ya-sand-100)', 'var(--ya-sand-700)'],
  end: ['var(--ya-sand-50)', 'var(--ya-sand-500)'],
  none: ['var(--ya-sand-50)', 'var(--ya-sand-400)'],
};
