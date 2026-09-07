/**
 * Libellé de capacité d'une formule VIP.
 *
 * `base_capacity` est le nombre de personnes couvertes par le prix de la table,
 * et `max_extra_persons` ce qu'on peut ajouter au-delà, à `extra_person_price`
 * la personne. Le compteur du tunnel (VipGuestCounter) part de 1 : il n'existe
 * AUCUN minimum de convives, nulle part, ni côté front ni côté serveur.
 *
 * Écrire « 8 pers. min » sur une carte de formule était donc faux dans le sens
 * exactement opposé à la réalité — un groupe de quatre lisait qu'il n'avait pas
 * le droit de réserver. Un seul helper pour que la carte, la feuille d'upsell et
 * le récapitulatif ne puissent plus diverger sur ce point.
 */
export function tableCapacityLabel(
  pack: { baseCapacity: number; maxExtraPersons?: number | null },
  t: (key: string) => string,
): string {
  const base = Math.max(1, pack.baseCapacity || 1);
  const extra = Math.max(0, pack.maxExtraPersons ?? 0);
  const ceiling = base + extra;

  // Sans supplément possible, la table a une seule limite : on ne dit qu'elle.
  if (extra === 0) {
    return (t('ticketSel.upToGuests') || 'jusqu’à {n} pers.').replace('{n}', String(ceiling));
  }

  // Avec supplément, les deux chiffres comptent : ce que le prix couvre, et
  // jusqu'où la table peut monter. Taire le premier ferait passer les personnes
  // en supplément pour une surprise au moment de payer.
  return (t('ticketSel.includedUpToGuests') || '{base} pers. incluses · jusqu’à {n}')
    .replace('{base}', String(base))
    .replace('{n}', String(ceiling));
}
