// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — mise en forme des données live d'une soirée.
//
// La liste invités est un TYPE D'ENTRÉE au même titre qu'un billet : une
// soirée qui n'ouvre qu'une guest list a bel et bien quelque chose à proposer,
// et le bloc « Billetterie » doit la montrer. Le calcul est pur (aucune
// requête) pour que l'aperçu du canvas et le rendu d'envoi disent la même
// chose alors qu'ils interrogent la base chacun de leur côté.
//
// ⚠️ Port Deno : supabase/functions/_shared/email-studio-html.ts embarque une
// copie de ces fonctions. Toute modification ici doit y être répercutée.
// ─────────────────────────────────────────────────────────────────────────────

import type { TicketRow } from './types';

/** Colonnes de `guest_lists` nécessaires à la ligne d'entrée. */
export interface GuestListOffer {
  holder_type?: string | null;
  free_before_time?: string | null;
  includes_drink?: boolean | null;
}

/**
 * Part guest list publique à montrer dans l'email : la part maison d'abord,
 * sinon la première marquée « visible sur la page club ». Miroir exact de la
 * page billetterie publique (TicketSelection) — l'email ne promet jamais une
 * entrée que la page ne propose pas.
 */
export function pickPublicGuestList<T extends GuestListOffer>(parts: readonly T[]): T | null {
  if (!parts || parts.length === 0) return null;
  return parts.find((p) => p.holder_type === 'club') ?? parts[0] ?? null;
}

/** Prix affiché d'une entrée guest list : elle est gratuite, toujours. */
export const GUEST_LIST_PRICE = 'Gratuit';

/**
 * Ligne « Liste invités » du bloc Billetterie. Le sous-titre porte ce qui
 * conditionne l'entrée : l'heure limite de gratuité et la boisson offerte.
 */
export function guestListTicketRow(part: GuestListOffer): TicketRow {
  const before = String(part.free_before_time || '').slice(0, 5);
  const bits: string[] = [];
  if (before) bits.push(`avant ${before}`);
  if (part.includes_drink) bits.push('boisson offerte');
  return { n: 'Liste invités', s: bits.join(' · '), p: GUEST_LIST_PRICE, out: false };
}

/**
 * Offre d'entrée complète d'une soirée : tranches de billetterie puis liste
 * invités. Renvoie aussi `guestListOnly` — la seule entrée est gratuite, donc
 * le bouton du bloc ne peut pas dire « Prendre mes billets ».
 */
export function buildEntryRows(
  ticketRows: readonly TicketRow[],
  guestList: GuestListOffer | null,
): { tickets: TicketRow[]; guestListOnly: boolean } {
  const tickets = [...ticketRows];
  if (guestList) tickets.push(guestListTicketRow(guestList));
  return { tickets, guestListOnly: ticketRows.length === 0 && !!guestList };
}

/**
 * Libellé de prix de la carte événement. Une soirée gratuite le dit ; une
 * soirée sans aucun tarif connu ne dit rien (jamais « À partir de 0 € »).
 * Même vocabulaire que les surfaces publiques (eventPriceLabel).
 */
export function priceFromLabel(activePrices: readonly number[], hasGuestList: boolean): string | null {
  const paid = activePrices.filter((p) => p > 0);
  if (paid.length) return `À partir de ${formatEuro(Math.min(...paid))}`;
  if (hasGuestList || activePrices.length) return GUEST_LIST_PRICE;
  return null;
}

/** « 12 € » / « 12,50 € » — même formatage des deux côtés du rendu. */
export function formatEuro(amount: number): string {
  return `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace('.', ',')} €`;
}

/**
 * Libellé du bouton du bloc Billetterie. Le rendu email l'émet tel quel (pas
 * d'i18n : un email part dans la langue de sa campagne, écrite en français),
 * et le canvas doit afficher exactement le même mot que ce qui partira.
 */
export const TICKETS_CTA_LABEL = 'Prendre mes billets';
export const GUEST_LIST_CTA_LABEL = 'M’inscrire à la liste';

export function ticketsCtaLabel(guestListOnly?: boolean): string {
  return guestListOnly ? GUEST_LIST_CTA_LABEL : TICKETS_CTA_LABEL;
}

/**
 * Kicker du bloc — même grammaire que le bloc Table VIP (« Bottle service ») :
 * une étiquette mono accent qui nomme l'offre avant qu'on lise les lignes.
 * En liste invités seule c'est « ENTRÉE » et pas « LISTE INVITÉS » : la ligne
 * en dessous porte déjà ce nom, et un titre qui se répète ressemble à un bug.
 */
export function ticketsKicker(guestListOnly?: boolean): string {
  return (guestListOnly ? 'Entrée' : 'Billetterie').toUpperCase();
}

/** Badge des tranches fermées — un mot, pas seulement du gris et un barré. */
export const SOLD_OUT_CHIP = 'ÉPUISÉ';

/**
 * true = le tarif est un MONTANT (il porte un chiffre). Sinon c'est une offre
 * (« Gratuit », « Sur invitation ») : elle se rend en pastille, pas en nombre.
 */
export function isPricedRow(price: string): boolean {
  return /\d/.test(String(price || ''));
}

/**
 * Sous-titre d'une tranche fermée. Le badge « ÉPUISÉ » porte déjà l'info :
 * si la description du club ne dit que ce mot, on ne l'écrit pas deux fois.
 */
export function soldOutSub(sub: string): string {
  const s = String(sub || '').trim();
  const bare = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s!.]+$/, '');
  return ['epuise', 'epuisee', 'complet', 'sold out', 'soldout', 'agotado', 'agotada'].includes(bare) ? '' : s;
}
