// Règle partagée des TYPES d'entrée guest list (normal / drink / table=VIP).
// Miroir front de public.guest_list_allowed_entry_types (migration
// 20260723200000) — les trois surfaces détenteurs (owner, promoteur, DJ) et la
// page publique raisonnent sur la même liste.

export type GLEntryType = 'normal' | 'drink' | 'table';

/** Ordre canonique d'affichage : standard → boisson → VIP. */
export const GL_ENTRY_TYPES: GLEntryType[] = ['normal', 'drink', 'table'];

export interface GLTypeSource {
  holder_type: string;
  quota_normal: number | null;
  quota_drink: number | null;
  quota_table: number | null;
  entry_kind?: string | null;
}

/**
 * Types qu'une part PEUT offrir : la part maison (club) choisit librement les
 * trois ; une part déléguée ventilée offre les types à quota > 0 ; une part
 * sans ventilation reste sur son entry_kind (elle ne peut pas inventer des
 * boissons que le club n'a pas accordées).
 */
export function allowedEntryTypes(part: GLTypeSource): GLEntryType[] {
  if (part.holder_type === 'club') return [...GL_ENTRY_TYPES];
  const qn = part.quota_normal ?? 0, qd = part.quota_drink ?? 0, qt = part.quota_table ?? 0;
  if (qn + qd + qt > 0) {
    const out: GLEntryType[] = [];
    if (qn > 0) out.push('normal');
    if (qd > 0) out.push('drink');
    if (qt > 0) out.push('table');
    return out;
  }
  const kind = (part.entry_kind || 'normal') as GLEntryType;
  return GL_ENTRY_TYPES.includes(kind) ? [kind] : ['normal'];
}

/**
 * Offre effective du lien public :
 *  - le choix explicite du détenteur (public_entry_types) s'il en a fait un ;
 *  - sinon TOUS les types que la part alloue réellement (quota > 0) — une part
 *    « 10 normales + 2 VIP » propose donc les deux, sans réglage préalable ;
 *  - sinon son type primaire seul (part club à quota global, sans ventilation).
 *
 * Miroir exact de la résolution serveur dans create-guest-list-entry : les deux
 * doivent offrir la même chose, sinon le guest choisit un type que le serveur
 * refuse.
 */
export function effectivePublicTypes(part: GLTypeSource & { public_entry_types?: string[] | null }): GLEntryType[] {
  const explicit = (part.public_entry_types || []).filter(
    (t): t is GLEntryType => GL_ENTRY_TYPES.includes(t as GLEntryType),
  );
  if (explicit.length) return GL_ENTRY_TYPES.filter(t => explicit.includes(t));
  const qn = part.quota_normal ?? 0, qd = part.quota_drink ?? 0, qt = part.quota_table ?? 0;
  if (qn + qd + qt > 0) {
    const out: GLEntryType[] = [];
    if (qn > 0) out.push('normal');
    if (qd > 0) out.push('drink');
    if (qt > 0) out.push('table');
    return out;
  }
  const kind = (part.entry_kind || 'normal') as GLEntryType;
  return [GL_ENTRY_TYPES.includes(kind) ? kind : 'normal'];
}

/** Clé i18n du libellé d'un type (le 3e type est affiché « VIP » partout). */
export function entryTypeLabelKey(type: GLEntryType): string {
  return type === 'table' ? 'guestList.presets.entryVip'
    : type === 'drink' ? 'guestList.presets.entryDrink'
    : 'guestList.presets.entryNormal';
}
