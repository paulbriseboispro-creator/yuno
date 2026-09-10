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

import type { GuestListLive, TablePackRow, TicketRow } from './types';
import { GUEST_LIST_ROW_ID } from './types';

/** Colonnes de `guest_lists` nécessaires au bloc Liste invités. */
export interface GuestListOffer {
  id?: string;
  holder_type?: string | null;
  free_before_time?: string | null;
  includes_drink?: boolean | null;
  quota?: number | null;
  show_remaining?: boolean | null;
}

/**
 * Données live du bloc « Liste invités ». `entries` = inscrits de la part ;
 * les places restantes ne s'affichent que si le pro l'a voulu.
 */
export function buildGuestListLive(part: GuestListOffer | null, entries: number): GuestListLive | null {
  if (!part) return null;
  const quota = part.quota != null ? Number(part.quota) : null;
  const remaining = part.show_remaining && quota != null ? Math.max(0, quota - entries) : null;
  return {
    freeBefore: String(part.free_before_time || '').slice(0, 5) || null,
    includesDrink: !!part.includes_drink,
    remaining,
  };
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
  return { id: GUEST_LIST_ROW_ID, n: 'Liste invités', s: bits.join(' · '), p: GUEST_LIST_PRICE, out: false };
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
  // Depuis le 2026-09-10, les BILLETS seulement : la liste invités a son
  // propre bloc. Un email envoyé à 9 600 personnes pour une soirée sans
  // billetterie Yuno s'était transformé, sans que le pro le choisisse, en
  // bouton « M'inscrire à la liste ». `guestListOnly` reste calculé pour le
  // libellé de prix de la carte événement.
  return { tickets: [...ticketRows], guestListOnly: ticketRows.length === 0 && !!guestList };
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

export const GUEST_LIST_KICKER = 'LISTE INVITÉS';

/** Sous-titre live du bloc Liste invités : « Gratuit avant 00:30 · boisson offerte · 42 places restantes ». */
export function guestListSummary(gl: GuestListLive): string {
  const bits: string[] = [];
  bits.push(gl.freeBefore ? `Gratuit avant ${gl.freeBefore}` : 'Entrée gratuite');
  if (gl.includesDrink) bits.push('boisson offerte');
  if (gl.remaining != null) {
    bits.push(gl.remaining === 0 ? 'complet' : `${gl.remaining} place${gl.remaining > 1 ? 's' : ''} restante${gl.remaining > 1 ? 's' : ''}`);
  }
  return bits.join(' · ');
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

// ── Pilier tables VIP ────────────────────────────────────────────────────────

/** Colonnes de `table_packs` nécessaires à une ligne de formule. */
export interface TablePackOffer {
  id?: string | null;
  zone_id?: string | null;
  name?: string | null;
  base_price?: number | null;
  base_capacity?: number | null;
  included_bottles_quota?: number | null;
  included_items?: string | null;
  minimum_spend?: number | null;
  payment_mode?: string | null;
  position?: number | null;
}

/**
 * Mention « réglé au club » — un ARGUMENT, pas un prix.
 *
 * Réserver une table réglée sur place passe quand même par Yuno : la résa est
 * confirmée tout de suite, il n'y a simplement pas d'acompte à sortir. C'est
 * exactement ce que dit la page de réservation (`tableCheckout.onSiteDesc`),
 * et c'est un argument de vente. L'email l'écrit donc dans la ligne de
 * bénéfices, jamais à la place du montant.
 */
export const TABLE_ON_SITE_NOTE = 'sans acompte';

/**
 * Ce que la formule contient, en une ligne : le nombre de couverts, les
 * bouteilles incluses, les extras du club, et « sans acompte » quand le
 * règlement se fait au club. C'est la ligne qui VEND — « 6 pers. ·
 * 2 bouteilles » dit en cinq mots ce qu'un paragraphe rate.
 */
export function tablePackSubtitle(p: TablePackOffer): string {
  const bits: string[] = [];
  const seats = Number(p.base_capacity || 0);
  if (seats > 0) bits.push(`${seats} pers.`);
  const bottles = Number(p.included_bottles_quota || 0);
  if (bottles > 0) bits.push(`${bottles} bouteille${bottles > 1 ? 's' : ''} incluse${bottles > 1 ? 's' : ''}`);
  const extras = String(p.included_items || '').trim();
  if (extras) bits.push(extras.toLowerCase());
  if (String(p.payment_mode || '') === 'on_site') bits.push(TABLE_ON_SITE_NOTE);
  return bits.join(' · ');
}

/**
 * Prix d'une formule — le PRIX, quel que soit le mode de règlement.
 *
 * Une table à 300 € réglée au club coûte 300 €, et la page de réservation
 * affiche bien ce montant. Masquer le chiffre parce que Yuno n'encaisse pas
 * l'acompte enlevait au client la seule information qui lui permet de choisir,
 * et renvoyait « sur place » — soit exactement l'inverse du but, qui est de le
 * faire réserver SUR Yuno. À défaut de prix de base, le minimum de
 * consommation fait foi : c'est la somme qu'il devra sortir.
 */
export function tablePackPrice(p: TablePackOffer): string {
  const base = Number(p.base_price || 0);
  if (base > 0) return formatEuro(base);
  const min = Number(p.minimum_spend || 0);
  if (min > 0) return `Min. ${formatEuro(min)}`;
  // Aucun montant connu : on invite à réserver au lieu d'écrire « 0 € ».
  return 'Sur demande';
}

/**
 * Formules → lignes d'email, TOUTES, des moins chères aux plus chères (on
 * entre dans une offre par le bas, pas par la loge à 2 000 €). Le tri se fait
 * sur le montant réel : un mode de règlement n'a jamais été un prix, et le
 * traiter comme tel écrasait l'ordre et coupait les formules du haut de gamme.
 *
 * C'est le BLOC qui choisit lesquelles montrer (`hiddenPacks`) — pas ce
 * calcul : le pro doit pouvoir décider, et pour décider il faut tout voir.
 */
export function buildTablePackRows(packs: readonly TablePackOffer[]): TablePackRow[] {
  const priced = packs.map((p) => ({
    p,
    amount: Number(p.base_price || 0) || Number(p.minimum_spend || 0) || Number.POSITIVE_INFINITY,
  }));
  priced.sort((a, b) => (a.amount - b.amount) || (Number(a.p.position || 0) - Number(b.p.position || 0)));
  return priced.map(({ p }) => ({
    id: p.id ? String(p.id) : undefined,
    n: String(p.name || 'Table'),
    s: tablePackSubtitle(p),
    p: tablePackPrice(p),
  }));
}

/**
 * Rareté des tables, en un mot. Le seuil d'urgence est bas volontairement :
 * « plus que 2 tables » fait agir, « 9 tables disponibles » rassure et fait
 * remettre à demain. Au-dessus du seuil on informe, on ne presse pas.
 */
export const TABLE_SCARCITY_THRESHOLD = 3;

export function tablesLeftLabel(left: number): string {
  if (left <= 0) return 'Complet';
  if (left === 1) return 'Dernière table';
  if (left <= TABLE_SCARCITY_THRESHOLD) return `Plus que ${left} tables`;
  return `${left} tables disponibles`;
}

/** true = la rareté mérite la pastille d'alerte (ambre), pas une ligne calme. */
export function isTableScarce(left: number): boolean {
  return left > 0 && left <= TABLE_SCARCITY_THRESHOLD;
}

/** Libellés par défaut du bloc — le canvas et l'envoi disent le même mot. */
export const TABLE_KICKER = 'Bottle service';
export const TABLE_CTA_LABEL = 'Réserver une table';

/**
 * Libellés par défaut du bloc Soirée. Comme partout dans le rendu email, ils
 * ne passent PAS par l'i18n : un email part dans la langue de sa campagne,
 * écrite en français, et le canvas doit afficher exactement ce qui partira.
 */
export const EVENT_CTA_LABEL = "Voir l'événement";
export const EVENT_META_DATE = 'Date';
export const EVENT_META_VENUE = 'Lieu';
export const EVENT_META_PRICE = 'Tarif';

/** Colonnes de `table_zones` nécessaires à une ligne de zone. */
export interface TableZoneOffer {
  id?: string | null;
  name?: string | null;
  position?: number | null;
}

/** « 6 à 8 pers. » quand la zone mélange les capacités, « 8 pers. » sinon. */
function seatsRange(packs: readonly TablePackOffer[]): string {
  const seats = packs.map((p) => Number(p.base_capacity || 0)).filter((n) => n > 0);
  if (!seats.length) return '';
  const min = Math.min(...seats);
  const max = Math.max(...seats);
  return min === max ? `${min} pers.` : `${min} à ${max} pers.`;
}

/**
 * Zones → lignes d'email : le nom du carré, sa fourchette de couverts et son
 * PRIX D'APPEL. C'est la vue épurée — trois carrés valent mieux que huit
 * formules dans un message qu'on parcourt au pouce, et le détail complet
 * attend sur la page de réservation.
 *
 * Une zone sans formule ouverte n'apparaît pas : on ne montre pas un carré
 * qu'on ne peut pas réserver.
 */
export function buildTableZoneRows(
  zones: readonly TableZoneOffer[],
  packs: readonly TablePackOffer[],
): TablePackRow[] {
  const rows = zones.map((z) => {
    const mine = packs.filter((p) => p.zone_id && z.id && String(p.zone_id) === String(z.id));
    if (!mine.length) return null;
    const amounts = mine
      .map((p) => Number(p.base_price || 0) || Number(p.minimum_spend || 0))
      .filter((n) => n > 0);
    const from = amounts.length ? Math.min(...amounts) : 0;
    const bits = [seatsRange(mine)].filter(Boolean);
    // « sans acompte » ne vaut que si TOUTE la zone se règle au club :
    // l'annoncer pour une zone mixte serait une promesse fausse.
    if (mine.every((p) => String(p.payment_mode || '') === 'on_site')) bits.push(TABLE_ON_SITE_NOTE);
    return {
      id: z.id ? String(z.id) : undefined,
      n: String(z.name || 'Carré'),
      s: bits.join(' · '),
      // Un seul tarif dans la zone : c'est LE prix, pas un « à partir de ».
      p: from > 0 ? (amounts.length > 1 && Math.max(...amounts) > from ? `dès ${formatEuro(from)}` : formatEuro(from)) : 'Sur demande',
      amount: from || Number.POSITIVE_INFINITY,
      pos: Number(z.position || 0),
    };
  }).filter(Boolean) as (TablePackRow & { amount: number; pos: number })[];
  rows.sort((a, b) => (a.amount - b.amount) || (a.pos - b.pos));
  return rows.map(({ id, n, s, p }) => ({ id, n, s, p }));
}

/**
 * Coupe « À partir de 18 € » en libellé + montant pour la vue épurée : le
 * chiffre mérite sa taille, le reste est du contexte. Sans chiffre
 * (« Gratuit »), tout part dans le montant — c'est lui l'argument.
 */
export function splitFromLabel(label: string): { label: string; value: string } {
  const s = String(label || '').trim();
  const m = /^(.*?)(\d[\d\s.,\u00a0]*\s*€?)$/.exec(s);
  if (!m || !m[2]) return { label: '', value: s };
  return { label: m[1].trim(), value: m[2].trim() };
}

/**
 * Destination des boutons Billetterie ET Table VIP : la page de SÉLECTION,
 * pas l'accueil de la soirée.
 *
 * `/billets` porte les DEUX offres — les tranches de billetterie, la part de
 * guest list publique, puis la section « Tables VIP » avec ses onglets de zone
 * et le bouton Réserver de chaque formule. C'est donc la page de choix des
 * deux piliers, et le nom de la route est trompeur.
 *
 * Le lecteur a déjà vu les tarifs dans l'email et cliqué un bouton qui dit ce
 * qu'il veut faire ; le renvoyer sur l'affiche lui redemande de décider une
 * seconde fois. On l'amène donc où il choisit sa tranche.
 *
 * Deux formes d'URL arrivent ici :
 * - un lien suivi `/l/<code>` — on ne peut PAS lui rallonger son chemin (sa
 *   destination est résolue côté serveur), on lui passe donc l'intention en
 *   paramètre et c'est la redirection qui compose la route ;
 * - une URL nue de soirée — on lui ajoute `/billets`, mais SEULEMENT sur les
 *   formes qui portent cette route. `/event/<uuid>` est le repli quand le slug
 *   d'hôte n'est pas résolu : il n'a pas de `/billets`, y renvoyer donnerait
 *   un 404. Dans le doute on laisse la page de la soirée, qui marche toujours.
 */
export const SELECTION_HINT = 'billets';

export function eventSelectionUrl(url: string, tracked: boolean): string {
  const raw = String(url || '');
  if (!raw) return raw;
  const [path, query] = splitQuery(raw);
  if (tracked) {
    const sep = query ? '&' : '?';
    return `${raw}${sep}to=${SELECTION_HINT}`;
  }
  // Formes qui portent réellement /billets (voir App.tsx).
  const deep = /\/events\/[^/?#]+\/[^/?#]+$/.test(path) || /\/club\/[^/?#]+\/event\/[^/?#]+$/.test(path);
  if (!deep) return raw;
  return `${path}/${SELECTION_HINT}${query ? `?${query}` : ''}`;
}

function splitQuery(url: string): [string, string] {
  const i = url.indexOf('?');
  return i === -1 ? [url, ''] : [url.slice(0, i), url.slice(i + 1)];
}
