// Célébrations — moments de succès RARES de l'app cliente (achat confirmé,
// entrée en boîte, palier fidélité). Orchestrateur unique : haptic de succès
// immédiat + événement DOM consommé par <CelebrationHost /> (monté une fois
// dans App). Discipline « succès rares » (cf. transitions.celebrate dans
// src/lib/motion.ts) : jamais pour du routinier — ajout panier, navigation,
// refresh… restent sur haptics.selection()/medium().
import { haptics } from '@/lib/haptics';

export type CelebrationKind = 'purchase' | 'entry' | 'tierUp' | 'orderReady';

export interface CelebrationDetail {
  kind: CelebrationKind;
  /** Sous-titre libre (nom du club pour 'entry'). */
  subtitle?: string;
  /** Palier atteint, pour 'tierUp'. */
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum';
}

export const CELEBRATE_EVENT = 'yuno:celebrate';
const ONCE_PREFIX = 'yuno_celebrated:';

/**
 * Déclenche une célébration. Fire-and-forget, ne throw jamais (même contrat
 * que haptics : une fête ratée ne casse pas un checkout).
 * 'orderReady' = haptic seul — le visuel est la carte qui passe au vert dans
 * LiveOrderStatus, pas un overlay par-dessus le Live.
 */
export function celebrate(kind: CelebrationKind, extra?: Omit<CelebrationDetail, 'kind'>): void {
  haptics.success();
  if (kind === 'orderReady') return;
  try {
    window.dispatchEvent(
      new CustomEvent<CelebrationDetail>(CELEBRATE_EVENT, { detail: { kind, ...extra } })
    );
  } catch {
    // CustomEvent indisponible : le haptic suffit.
  }
}

/**
 * Variante « une seule fois » (flag localStorage) : entrée en boîte
 * (1×/soirée, même si l'app est rouverte plusieurs fois pendant la nuit),
 * tier-up (1×/palier/club). Retourne true si la célébration a été jouée.
 */
export function celebrateOnce(
  onceKey: string,
  kind: CelebrationKind,
  extra?: Omit<CelebrationDetail, 'kind'>
): boolean {
  try {
    const key = ONCE_PREFIX + onceKey;
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch {
    // Storage indispo (navigation privée) : on célèbre quand même — au pire deux fois.
  }
  celebrate(kind, extra);
  return true;
}
