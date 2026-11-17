/** Raccourcis de l'admin : lettres des rubriques, et « est-on en train d'écrire ? ». */
/** Lettre → rubrique (g puis la lettre). */
export const GO_KEYS: Array<{ key: string; to: string; rubric: string }> = [
  { key: 't', to: '/admin', rubric: 'today' },
  { key: 'p', to: '/admin/pilot', rubric: 'pilot' },
  { key: 'd', to: '/admin/madrid', rubric: 'madrid' },
  { key: 'r', to: '/admin/pros', rubric: 'pros' },
  { key: 'c', to: '/admin/clients', rubric: 'clients' },
  { key: 'a', to: '/admin/money', rubric: 'money' },
  { key: 'm', to: '/admin/comms', rubric: 'comms' },
  { key: 'l', to: '/admin/legal', rubric: 'legal' },
  { key: 's', to: '/admin/system', rubric: 'system' },
];

export { isTyping } from '../ui/keys';
