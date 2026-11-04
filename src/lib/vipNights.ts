/**
 * Les soirées du Service VIP : à venir (ou en cours ce soir) d'abord, la plus
 * proche en tête ; passées ensuite, la plus récente en tête. Une soirée est
 * passée une fois finie ; sans heure de fin lisible, elle reste à venir.
 *
 * Une seule règle pour le sélecteur de soirée ET pour la soirée ouverte par
 * défaut : le Service VIP s'ouvrait sur la soirée la PLUS LOINTAINE (la liste
 * arrive triée du plus tard au plus tôt), au lieu de celle de ce soir.
 */
export interface VipNightLike {
  id: string;
  startAt: string;
  endAt: string | null;
}

export function splitVipNights<T extends VipNightLike>(events: T[], now: number = Date.now()): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const e of events) {
    const end = e.endAt ? new Date(e.endAt).getTime() : NaN;
    (Number.isFinite(end) && end < now ? past : upcoming).push(e);
  }
  const startOf = (e: T) => {
    const s = new Date(e.startAt).getTime();
    return Number.isFinite(s) ? s : Number.POSITIVE_INFINITY;
  };
  upcoming.sort((a, b) => startOf(a) - startOf(b));
  past.sort((a, b) => startOf(b) - startOf(a));
  return { upcoming, past };
}

/** La soirée ouverte par défaut : celle de ce soir, sinon la prochaine ; null s'il n'y en a aucune à venir. */
export function defaultVipNightId(events: VipNightLike[], now: number = Date.now()): string | null {
  return splitVipNights(events, now).upcoming[0]?.id ?? null;
}
