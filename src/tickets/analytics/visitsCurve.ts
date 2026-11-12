/**
 * Courbe des visites d'une soirée (Yuno Tickets › Analyses › Trafic, `?e=`) :
 * règles pures du mode « par jour ». La base rend des visites CUMULÉES (J-n → J) ;
 * le jour par jour s'en déduit ici, pour la soirée et pour la soirée comparée.
 * La moyenne des soirées précédentes a sa propre série par jour (`avg_day`), car
 * ses visites plus anciennes que le début de l'axe sont dans son premier cumul.
 */

/** Visites de chaque jour d'une courbe cumulée ; un point à venir (null) reste null. */
export function dailyFromCumulative(a: readonly (number | null)[]): (number | null)[] {
  return a.map((x, i) => (x === null ? null : Math.max(0, x - (i > 0 ? a[i - 1] ?? 0 : 0))));
}

/**
 * Le jour mis en avant en mode « par jour » : la veille pour une soirée à venir
 * (aujourd'hui n'est pas fini, le comparer à une journée entière tromperait),
 * sinon le dernier point de la courbe.
 */
export function headlineDayIndex(lastI: number, upcoming: boolean): number {
  return upcoming && lastI > 0 ? lastI - 1 : lastI;
}
