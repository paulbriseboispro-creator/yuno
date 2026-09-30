// Cachets DJ : qui joue (DJ Yuno ou artiste externe), où virer, avec quelle
// référence. Porte unique côté front — la base normalise de la même façon
// (`guard_dj_set_write`, `normalize_dj_payout_details`).

export { formatIban } from './promoterPayout';

/** IBAN compact en majuscules : « fr76 3000 … » → « FR763000… ». */
export const normalizeIban = (raw: string) => raw.replace(/\s+/g, '').toUpperCase();

/**
 * Vrai IBAN : forme (pays + clé + BBAN) ET clé de contrôle ISO 13616 (mod 97).
 * La base ne vérifie que la forme ; le mod 97 attrape la faute de frappe avant
 * qu'un virement parte sur un compte qui n'existe pas.
 */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/**
 * Référence de virement d'un set, stable et courte : « YDJ-1A2B3C4D ».
 * Même forme que les virements de co-organisation (`YCO-…`).
 */
export const djSetReference = (setId: string) =>
  `YDJ-${setId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export type DjSetPaymentMethod = 'transfer' | 'cash' | 'other';

export interface DjSetPerformer {
  dj_id?: string | null;
  artist_name?: string | null;
  dj?: { first_name?: string | null; last_name?: string | null; stage_name?: string | null } | null;
}

/** Nom affiché de l'interprète : nom de scène, prénom + nom, ou artiste externe. */
export function performerName(set: DjSetPerformer): string {
  if (set.dj) {
    const full = [set.dj.first_name, set.dj.last_name].filter(Boolean).join(' ').trim();
    return (set.dj.stage_name || '').trim() || full;
  }
  return (set.artist_name || '').trim();
}

/** Un set joué par un artiste sans compte Yuno. */
export const isExternalSet = (set: DjSetPerformer) => !set.dj_id;
