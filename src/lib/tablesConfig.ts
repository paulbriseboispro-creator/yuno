/**
 * Configuration pro des tables VIP — règles pures (testées), partagées par l'atelier club,
 * l'atelier organisateur et l'éditeur de plan. Aucune lecture réseau ici.
 *
 * Miroirs des gardes SQL de la vague A : `validate_table_pack` (YU002), `prevent_floor_plan_table_removal` (YU003).
 */

export type PackFormValues = {
  basePrice: string;
  baseCapacity: string;
  maxExtraPersons?: string;
  extraPersonPrice?: string;
  deposit: string;
  depositType: 'fixed' | 'percentage';
  minimumSpend?: string;
  paymentMode: 'online' | 'on_site';
};

/** Clé de champ → code d'erreur (la clé i18n est `tblp.err.<code>`). */
export type PackFormErrors = Partial<Record<
  'basePrice' | 'baseCapacity' | 'maxExtraPersons' | 'extraPersonPrice' | 'deposit' | 'minimumSpend',
  string
>>;

const num = (s: string | undefined): number => {
  if (s === undefined || s.trim() === '') return 0;
  return Number(s.replace(',', '.'));
};

/** Mêmes règles que le trigger serveur, vérifiées avant l'envoi pour montrer l'erreur sous le champ. */
export function validatePackForm(v: PackFormValues): PackFormErrors {
  const e: PackFormErrors = {};
  const price = num(v.basePrice);
  if (v.basePrice.trim() === '' || !Number.isFinite(price)) e.basePrice = 'price_required';
  else if (price < 0) e.basePrice = 'price_negative';

  const cap = num(v.baseCapacity);
  if (!Number.isFinite(cap) || cap < 1) e.baseCapacity = 'capacity_min';

  const extra = num(v.maxExtraPersons);
  if (!Number.isFinite(extra) || extra < 0) e.maxExtraPersons = 'extra_persons_negative';

  const extraPrice = num(v.extraPersonPrice);
  if (!Number.isFinite(extraPrice) || extraPrice < 0) e.extraPersonPrice = 'extra_price_negative';

  const spend = num(v.minimumSpend);
  if (!Number.isFinite(spend) || spend < 0) e.minimumSpend = 'minimum_spend_negative';

  const deposit = num(v.deposit);
  if (!Number.isFinite(deposit) || deposit < 0) e.deposit = 'deposit_negative';
  else if (v.paymentMode === 'online') {
    if (v.depositType === 'percentage') {
      if (deposit <= 0 || deposit > 100) e.deposit = 'deposit_percent_range';
    } else if (!e.basePrice && deposit > price) {
      e.deposit = 'deposit_exceeds_price';
    }
  }
  return e;
}

export const hasErrors = (e: object): boolean => Object.keys(e).length > 0;

export type TableServerError =
  | { kind: 'pack_invalid'; reason: string }
  | { kind: 'table_has_reservation'; tableId: string }
  | { kind: 'pack_cap' };

type ErrLike = { code?: string | null; message?: string | null } | null | undefined;

/** Traduit les erreurs serveur stables : YU001 plafond de formule, YU002 formule invalide, YU003 table vendue. */
export function parseTableServerError(err: ErrLike): TableServerError | null {
  if (!err) return null;
  const msg = err.message ?? '';
  if (err.code === 'YU002' || msg.startsWith('table_pack_invalid:')) {
    const m = /table_pack_invalid:([a-z_]+)/.exec(msg);
    return { kind: 'pack_invalid', reason: m ? m[1] : 'unknown' };
  }
  if (err.code === 'YU003' || msg.startsWith('table_has_reservation:')) {
    const m = /table_has_reservation:([^\s"]+)/.exec(msg);
    return { kind: 'table_has_reservation', tableId: m ? m[1] : '' };
  }
  if (err.code === 'YU001') return { kind: 'pack_cap' };
  return null;
}

/** Tables du plan sans formule liée (une table sans formule ne peut pas se vendre en mode élite). */
export function tablesWithoutPack<T extends { id: string; packId?: string | null }>(
  planTables: readonly T[],
  activePackIds: ReadonlySet<string>,
): T[] {
  return planTables.filter((t) => !t.packId || !activePackIds.has(t.packId));
}

/** Tables retirées du plan qui portent une résa active : à refuser avant l'envoi. */
export function removedSoldTables(
  previousIds: readonly string[],
  nextIds: readonly string[],
  soldIds: ReadonlySet<string>,
): string[] {
  const next = new Set(nextIds);
  return previousIds.filter((id) => !next.has(id) && soldIds.has(id));
}

/** Une écriture PostgREST `.select('id')` qui ne rend aucune ligne n'a rien enregistré (RLS silencieuse). */
export const touchedNothing = (data: readonly unknown[] | null | undefined): boolean => !data || data.length === 0;

/** Pourquoi « Utiliser pour une soirée » est impossible : clé de raison, ou null si possible. */
export function applyRoomBlocker(opts: {
  hasEligibleEvent: boolean;
  eventHasClub: boolean;
  eventHasReservations: boolean;
}): 'no_event' | 'club' | 'reservations' | null {
  if (opts.eventHasClub) return 'club';
  if (opts.eventHasReservations) return 'reservations';
  if (!opts.hasEligibleEvent) return 'no_event';
  return null;
}

export type TablesCollector = 'club' | 'organizer';

/** Qui encaisse les tables : même lecture que `event_payments_ready` (club hôte, sinon l'organisateur). */
export function tablesCollector(e: { venue_id?: string | null }): TablesCollector {
  return e.venue_id ? 'club' : 'organizer';
}

export type PaymentsBannerKind =
  | 'on_site_only'      // aucune formule en ligne : pas de Stripe nécessaire
  | 'ready'             // l'encaisseur peut encaisser
  | 'viewer_connect'    // je suis l'encaisseur et je peux relier Stripe
  | 'viewer_ask_owner'  // je suis l'encaisseur mais seul le fondateur relie Stripe
  | 'other_connect';    // l'autre partie (club / organisateur) doit relier Stripe

export function paymentsBannerKind(opts: {
  ready: boolean;
  hasOnlinePacks: boolean;
  collector: TablesCollector;
  viewer: TablesCollector;
  canManageStripe: boolean;
}): PaymentsBannerKind {
  if (!opts.hasOnlinePacks) return 'on_site_only';
  if (opts.ready) return 'ready';
  if (opts.collector !== opts.viewer) return 'other_connect';
  return opts.canManageStripe ? 'viewer_connect' : 'viewer_ask_owner';
}
