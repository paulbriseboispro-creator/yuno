/** Le ton de chaque état d'un lien de démo (un mot + une pastille, jamais la couleur seule). */
import type { Tone } from '@/admin/ui';
import type { DemoState } from './data';

export const STATE_TONE: Record<DemoState, Tone> = {
  ready: 'neutral',
  opened: 'positive',
  created: 'positive',
  expired: 'neutral',
  cut: 'neutral',
};
