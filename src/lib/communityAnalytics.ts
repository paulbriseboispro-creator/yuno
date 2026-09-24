/**
 * Analytics › Communauté et Trafic (lot E). Les chiffres viennent de
 * `get_community_overview` et `get_page_traffic` (migration 20260924200000) ;
 * ce module type les réponses et met en forme, il ne compte rien.
 */

export interface Bucket { bucket: string; n: number }

export interface CommunityOverview {
  ok: true;
  now: string;
  totals: {
    contacts: number;
    emailReachable: number;
    yunoCustomers: number;
    imported: number;
    followers: number;
    pushReachable: number;
    newFollowers30d: number;
    newContacts30d: number;
  };
  participation: { known: number; avg: number | null; buckets: Bucket[] };
  lastPurchase: { known: number; buckets: Bucket[] };
  growth: { known: number; series: Array<{ month: string; contacts: number; followers: number }> };
  byEvent: Array<{ id: string; title: string; startAt: string; participants: number; newContacts: number }>;
}

export interface PageTraffic {
  ok: true;
  now: string;
  tz: string;
  days: number;
  from: string;
  page: {
    kind: 'venue' | 'organizer';
    total: number;
    today: number;
    visitors: number;
    returning: number;
    series: Array<{ date: string; visits: number }>;
    sources: Array<{ source: string; visits: number }>;
  };
  events: {
    total: number;
    today: number;
    rows: Array<{ id: string; title: string; startAt: string; visits: number; today: number; ordered: number }>;
  };
}

/** Part en % arrondi, `null` sans base. */
export function pct(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** Part des contacts venus à UNE seule soirée (« 77,6 % une seule fois » chez Shotgun). */
export function onceShare(p: CommunityOverview['participation']): number | null {
  const one = p.buckets.find((b) => b.bucket === '1')?.n ?? 0;
  return pct(one, p.known);
}

/**
 * Deux séries d'ordres de grandeur différents ne partagent pas un axe : sinon
 * la plus petite reste collée à zéro. Au-delà d'un rapport de 5, la seconde
 * part sur son propre axe.
 */
export function needsSecondAxis(a: number[], b: number[]): boolean {
  const ma = Math.max(0, ...a);
  const mb = Math.max(0, ...b);
  if (ma === 0 || mb === 0) return false;
  return Math.max(ma, mb) / Math.min(ma, mb) > 5;
}

/**
 * On coupe le début vide de la courbe : un mois à zéro avant le premier
 * import dessinerait une fausse explosion de la base.
 */
export function trimLeadingEmpty<T extends { contacts: number; followers: number }>(series: T[]): T[] {
  const first = series.findIndex((s) => s.contacts > 0 || s.followers > 0);
  return first <= 0 ? series : series.slice(first);
}

/** Communauté › Goûts (`get_community_tastes`, plan Shotgun lot G). */
export interface CommunityTasteRow {
  genre: string;
  /** Personnes liées à ce genre (déclaré OU fréquenté), toujours ≥ threshold. */
  n: number;
  /** Sous-comptes : null sous le seuil, jamais un petit nombre. */
  declared: number | null;
  attended: number | null;
}

export interface CommunityTastes {
  ok: true;
  threshold: number;
  /** Personnes avec compte liées à la portée (achat, guest list, abonnement), opt-out exclus. */
  people: number;
  /** Personnes dont au moins un genre est connu. */
  known: number;
  declaredKnown: number;
  genres: CommunityTasteRow[];
  /** Genres tus parce que sous le seuil. */
  hidden: number;
}

/**
 * La vue ne s'allume qu'au-dessus du seuil : au moins un genre qui réunit
 * `threshold` personnes. En dessous, l'écran dit « pas encore assez de monde ».
 */
export function tastesReady(data: Pick<CommunityTastes, 'genres' | 'threshold'> | null | undefined): boolean {
  return !!data && data.genres.some((g) => g.n >= data.threshold);
}
