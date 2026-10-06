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

import type { GuestListLive, LineupArtist, TablePackRow, TicketRow } from './types';
import { GUEST_LIST_ROW_ID } from './types';
import { emailWords, formatEuroIn, type EmailWordsLang } from '../../../supabase/functions/_shared/email-words';

// Les libellés ci-dessous suivent la langue de l'e-mail (`lang`, français par
// défaut, mots de _shared/email-words.ts). Les constantes françaises restent
// exportées pour les écrans qui les montrent en exemple.

// ── « Complet » posé à la main ───────────────────────────────────────────────
//
// Le pro peut fermer un pilier SANS dépublier la soirée (src/lib/soldOut.ts :
// `events.tickets_sold_out` / `tables_sold_out` / `guest_list_sold_out`,
// `events.sold_out_pack_ids`, `guest_lists.manually_sold_out`). La page
// publique et les checkouts s'y plient ; l'email doit dire la même chose,
// sinon il vend une formule que la page refuse au clic. Les helpers ci-dessous
// sont le SEUL endroit où l'email lit ces drapeaux — canvas et envoi passent
// tous les deux par eux.

/** Les drapeaux d'une soirée, tels que le rendu email les consomme. */
export interface LiveSoldOut {
  ticketsSoldOut: boolean;
  tablesSoldOut: boolean;
  guestListSoldOut: boolean;
  soldOutPackIds: string[];
}

export const LIVE_OPEN: LiveSoldOut = {
  ticketsSoldOut: false, tablesSoldOut: false, guestListSoldOut: false, soldOutPackIds: [],
};

/** Lit les drapeaux d'une ligne `events` (snake_case) — jamais d'exception. */
export function liveSoldOut(e: {
  tickets_sold_out?: boolean | null;
  tables_sold_out?: boolean | null;
  guest_list_sold_out?: boolean | null;
  sold_out_pack_ids?: string[] | null;
} | null | undefined): LiveSoldOut {
  if (!e) return LIVE_OPEN;
  return {
    ticketsSoldOut: !!e.tickets_sold_out,
    tablesSoldOut: !!e.tables_sold_out,
    guestListSoldOut: !!e.guest_list_sold_out,
    soldOutPackIds: Array.isArray(e.sold_out_pack_ids) ? e.sold_out_pack_ids.map(String) : [],
  };
}

/** Billetterie fermée à la main : chaque tranche se lit « épuisé ». */
export function applyTicketsSoldOut(rows: readonly TicketRow[], flags: LiveSoldOut): TicketRow[] {
  return flags.ticketsSoldOut ? rows.map((r) => ({ ...r, out: true })) : [...rows];
}

/**
 * Formules encore proposées : celles que le pro n'a pas nommées complètes
 * pour CETTE soirée. Miroir de `_event_tables_left` (SQL) — les formules d'un
 * club sont venue-scopées, donc c'est l'événement qui porte la fermeture.
 */
export function openTablePacks<T extends { id?: string | null }>(packs: readonly T[], flags: LiveSoldOut): T[] {
  if (!flags.soldOutPackIds.length) return [...packs];
  return packs.filter((p) => !p.id || !flags.soldOutPackIds.includes(String(p.id)));
}

/**
 * Tables encore libres. `null` = la soirée n'ouvre aucune table (le bloc
 * s'efface) ; 0 = complet (la carte le dit, le bouton s'efface). Même calcul
 * que `_event_tables_left` : formules ouvertes moins réservations, et une
 * soirée fermée à la main est complète quel que soit le stock.
 */
export function tablesLeftFor(openTotal: number, reserved: number, flags: LiveSoldOut): number | null {
  if (flags.tablesSoldOut) return 0;
  if (openTotal <= 0) return null;
  return Math.max(0, openTotal - reserved);
}

/** Colonnes de `guest_lists` nécessaires au bloc Liste invités. */
export interface GuestListOffer {
  id?: string;
  holder_type?: string | null;
  free_before_time?: string | null;
  includes_drink?: boolean | null;
  quota?: number | null;
  show_remaining?: boolean | null;
  manually_sold_out?: boolean | null;
}

/**
 * Données live du bloc « Liste invités ». `entries` = inscrits de la part ;
 * les places restantes ne s'affichent que si le pro l'a voulu. Une part
 * fermée à la main (toute la soirée, ou cette part seule) se lit « complet »
 * même sans quota affiché : c'est ce que dit la page d'inscription.
 */
export function buildGuestListLive(
  part: GuestListOffer | null,
  entries: number,
  flags: LiveSoldOut = LIVE_OPEN,
): GuestListLive | null {
  if (!part) return null;
  const quota = part.quota != null ? Number(part.quota) : null;
  const closed = flags.guestListSoldOut || !!part.manually_sold_out;
  const remaining = closed ? 0 : (part.show_remaining && quota != null ? Math.max(0, quota - entries) : null);
  return {
    freeBefore: String(part.free_before_time || '').slice(0, 5) || null,
    includesDrink: !!part.includes_drink,
    remaining,
    soldOut: closed || remaining === 0,
  };
}

/** true = la liste n'accepte plus d'inscription (fermée à la main ou pleine). */
export function isGuestListClosed(gl: GuestListLive | null | undefined): boolean {
  return !!gl && (!!gl.soldOut || gl.remaining === 0);
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
export function guestListTicketRow(part: GuestListOffer, lang: EmailWordsLang = 'fr'): TicketRow {
  const w = emailWords(lang);
  const before = String(part.free_before_time || '').slice(0, 5);
  const bits: string[] = [];
  if (before) bits.push(w.glBefore(before));
  if (part.includes_drink) bits.push(w.freeDrink);
  return { id: GUEST_LIST_ROW_ID, n: w.guestListRow, s: bits.join(' · '), p: w.free, out: false };
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
export function priceFromLabel(activePrices: readonly number[], hasGuestList: boolean, lang: EmailWordsLang = 'fr'): string | null {
  const w = emailWords(lang);
  const paid = activePrices.filter((p) => p > 0);
  if (paid.length) return w.priceFrom(formatEuro(Math.min(...paid), lang));
  if (hasGuestList || activePrices.length) return w.free;
  return null;
}

/**
 * Lieu d'une carte Soirée : « Club — Ville ». Sans nom de lieu, la ville
 * seule (jamais « — Paris »).
 */
export function joinVenueLabel(venueName: string | null | undefined, city: string | null | undefined): string {
  const v = String(venueName || '').trim();
  const c = String(city || '').trim();
  if (v && c) return `${v} — ${c}`;
  return v || c;
}

/** « 12 € » / « 12,50 € » (« €12.50 » en anglais) — même formatage des deux côtés du rendu. */
export function formatEuro(amount: number, lang: EmailWordsLang = 'fr'): string {
  return formatEuroIn(amount, lang);
}

// ── Yuno CRM : soirée d'une billetterie connectée (Shotgun) ─────────────────
// Miroir EXACT dans supabase/functions/_shared/email-studio-html.ts.
// Une soirée miroir n'a ni tranches Yuno ni page Yuno : ses tarifs publics
// viennent de la billetterie (RPC get_external_event_live), le bouton part
// chez elle, marqué UTM pour que la vente se relise dans ses exports.

/**
 * Un tarif public de la billetterie (RPC get_external_event_live). `out` =
 * tout son stock est vendu ; `id` = son id chez la billetterie (absent pour
 * une soirée importée sans id de tarif).
 */
export interface ExternalDeal { id?: string | null; name: string | null; price: number | null; out?: boolean | null }

/** Tarifs montrés au plus (les tranches Yuno en montrent 4 ; un tarif se décroche). */
export const EXTERNAL_ROWS_MAX = 6;

/**
 * Id de ligne d'un tarif externe — sert à le décrocher du bloc Billetterie
 * (`hiddenRows`). L'id de la billetterie quand elle en donne un, sinon le nom.
 */
export function externalRowId(d: ExternalDeal): string {
  const id = String(d.id ?? '').trim();
  return id ? `ext:${id}` : `ext:n:${artistKey(String(d.name || ''))}`;
}

/**
 * Tarifs publics d'une soirée externe, comme des tranches. Un tarif dont le
 * stock est vendu, ou toute la soirée complète, se lit « épuisé » ; un tarif
 * à 0 € est une entrée GRATUITE (la guest list Shotgun) : il se lit
 * « Gratuit », en pastille, jamais « 0 € ».
 */
export function externalTicketRows(deals: readonly ExternalDeal[], soldOut: boolean, lang: EmailWordsLang = 'fr'): TicketRow[] {
  return deals
    .filter((d) => d.name && String(d.name).trim())
    .slice(0, EXTERNAL_ROWS_MAX)
    .map((d) => {
      const price = Number(d.price || 0);
      return {
        id: externalRowId(d),
        n: String(d.name).trim(),
        s: '',
        p: price > 0 ? formatEuro(price, lang) : emailWords(lang).free,
        out: soldOut || !!d.out,
      };
    });
}

/** Prix d'appel d'une soirée externe : aucun si elle est complète, jamais un tarif épuisé. */
export function externalActivePrices(deals: readonly ExternalDeal[], soldOut: boolean): number[] {
  if (soldOut) return [];
  return deals.filter((d) => !d.out).map((d) => Number(d.price)).filter((p) => Number.isFinite(p) && p >= 0);
}

/**
 * Ajoute utm_source / utm_medium=email sans écraser ceux déjà posés. Miroir de
 * l'edge : à l'envoi réel la source vaut `yuno-m-<campagne>` (seul champ que
 * l'API Tickets de Shotgun rend tel quel) ; sans campagne (aperçu), `yuno`.
 */
export function withEmailUtm(url: string, source: string | null = null): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', source || 'yuno');
    if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'email');
    return u.toString();
  } catch {
    return url;
  }
}

// ── Line-up (bloc « lineup ») ────────────────────────────────────────────────
// Miroir EXACT dans supabase/functions/_shared/email-studio-html.ts.

/** Sur-titre par défaut du bloc Line-up. */
export const LINEUP_KICKER = 'LINE-UP';
/** Artistes montrés au plus — au-delà, l'email devient un annuaire. */
export const LINEUP_MAX = 24;

/** Clé de comparaison d'un nom (casse, accents et espaces ignorés). */
export function artistKey(name: string): string {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

/** URL de photo utilisable dans un email : https, sans espace ni guillemet. */
export function lineupPhoto(url: unknown): string | null {
  const u = typeof url === 'string' ? url.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}

/**
 * Initiales d'un artiste, pour la pastille sans photo : les deux premiers
 * mots qui ne sont pas un liant de line-up (« b2b », « x », « & »…).
 */
export function artistInitials(name: string): string {
  const words = String(name || '').split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w) && !/^(b2b|b3b|vs\.?|x|feat\.?|ft\.?|&|and|et|y)$/i.test(w));
  const letters = words.slice(0, 2).map((w) => (w.match(/[\p{L}\p{N}]/u) || [''])[0]);
  return letters.join('').toUpperCase() || '?';
}

/**
 * Les artistes que montre un bloc Line-up : ceux de la soirée (moins ceux que
 * le pro a décrochés), puis ceux qu'il a ajoutés à la main. Un même nom n'y
 * figure qu'une fois ; la photo connue l'emporte sur l'absence de photo.
 * Jamais de nom d'exemple : vide = le bloc s'efface.
 */
export function lineupArtists(
  live: readonly LineupArtist[] | null | undefined,
  block: { hidden?: string[] | null; extra?: readonly LineupArtist[] | null },
): LineupArtist[] {
  const hidden = new Set((block.hidden || []).map((h) => artistKey(h)));
  const out: LineupArtist[] = [];
  const at = new Map<string, number>();
  const push = (a: LineupArtist | null | undefined, fromNight: boolean) => {
    const name = String(a?.name || '').trim().slice(0, 120);
    if (!name) return;
    const key = artistKey(name);
    if (fromNight && hidden.has(key)) return;
    const photo = lineupPhoto(a?.photo);
    const i = at.get(key);
    if (i != null) {
      if (!out[i].photo && photo) out[i] = { ...out[i], photo };
      return;
    }
    at.set(key, out.length);
    out.push({ name, photo });
  };
  for (const a of live || []) push(a, true);
  for (const a of block.extra || []) push(a, false);
  return out.slice(0, LINEUP_MAX);
}

/** true = le bloc se rend en grille de photos (au moins une photo connue). */
export function lineupUsesPhotos(photos: boolean | undefined, artists: readonly LineupArtist[]): boolean {
  return photos !== false && artists.some((a) => !!a.photo);
}

/** Les artistes en rangées de trois (la grille de photos). */
export function lineupRows<T>(items: readonly T[], perRow = 3): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
}

/**
 * Libellé du bouton du bloc Billetterie. Le rendu email l'émet tel quel (pas
 * d'i18n : un email part dans la langue de sa campagne, écrite en français),
 * et le canvas doit afficher exactement le même mot que ce qui partira.
 */
export const TICKETS_CTA_LABEL = 'Prendre mes billets';
export const GUEST_LIST_CTA_LABEL = 'M’inscrire à la liste';

export function ticketsCtaLabel(guestListOnly?: boolean, lang: EmailWordsLang = 'fr'): string {
  const w = emailWords(lang);
  return guestListOnly ? w.guestListCta : w.ticketsCta;
}

/**
 * Kicker du bloc — même grammaire que le bloc Table VIP (« Bottle service ») :
 * une étiquette mono accent qui nomme l'offre avant qu'on lise les lignes.
 * En liste invités seule c'est « ENTRÉE » et pas « LISTE INVITÉS » : la ligne
 * en dessous porte déjà ce nom, et un titre qui se répète ressemble à un bug.
 */
export function ticketsKicker(guestListOnly?: boolean, lang: EmailWordsLang = 'fr'): string {
  const w = emailWords(lang);
  return guestListOnly ? w.entryKicker : w.ticketsKicker;
}

export const GUEST_LIST_KICKER = 'LISTE INVITÉS';

/** Sous-titre live du bloc Liste invités : « Gratuit avant 00:30 · boisson offerte · 42 places restantes ». */
export function guestListSummary(gl: GuestListLive, lang: EmailWordsLang = 'fr'): string {
  const w = emailWords(lang);
  const bits: string[] = [];
  bits.push(gl.freeBefore ? w.glFreeBefore(gl.freeBefore) : w.glFreeEntry);
  if (gl.includesDrink) bits.push(w.freeDrink);
  if (isGuestListClosed(gl)) {
    bits.push(w.full);
  } else if (gl.remaining != null) {
    bits.push(w.spotsLeft(gl.remaining));
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
export function tablePackSubtitle(p: TablePackOffer, lang: EmailWordsLang = 'fr'): string {
  const w = emailWords(lang);
  const bits: string[] = [];
  const seats = Number(p.base_capacity || 0);
  if (seats > 0) bits.push(w.seats(seats));
  const bottles = Number(p.included_bottles_quota || 0);
  if (bottles > 0) bits.push(w.bottles(bottles));
  const extras = String(p.included_items || '').trim();
  if (extras) bits.push(extras.toLowerCase());
  if (String(p.payment_mode || '') === 'on_site') bits.push(w.noDeposit);
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
export function tablePackPrice(p: TablePackOffer, lang: EmailWordsLang = 'fr'): string {
  const w = emailWords(lang);
  const base = Number(p.base_price || 0);
  if (base > 0) return formatEuro(base, lang);
  const min = Number(p.minimum_spend || 0);
  if (min > 0) return w.minSpend(formatEuro(min, lang));
  // Aucun montant connu : on invite à réserver au lieu d'écrire « 0 € ».
  return w.onRequest;
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
export function buildTablePackRows(packs: readonly TablePackOffer[], lang: EmailWordsLang = 'fr'): TablePackRow[] {
  const priced = packs.map((p) => ({
    p,
    amount: Number(p.base_price || 0) || Number(p.minimum_spend || 0) || Number.POSITIVE_INFINITY,
  }));
  priced.sort((a, b) => (a.amount - b.amount) || (Number(a.p.position || 0) - Number(b.p.position || 0)));
  return priced.map(({ p }) => ({
    id: p.id ? String(p.id) : undefined,
    n: String(p.name || emailWords(lang).tableDefault),
    s: tablePackSubtitle(p, lang),
    p: tablePackPrice(p, lang),
  }));
}

/**
 * Rareté des tables, en un mot. Le seuil d'urgence est bas volontairement :
 * « plus que 2 tables » fait agir, « 9 tables disponibles » rassure et fait
 * remettre à demain. Au-dessus du seuil on informe, on ne presse pas.
 */
export const TABLE_SCARCITY_THRESHOLD = 3;

export function tablesLeftLabel(left: number, lang: EmailWordsLang = 'fr'): string {
  return emailWords(lang).tablesLeft(left, TABLE_SCARCITY_THRESHOLD);
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
function seatsRange(packs: readonly TablePackOffer[], lang: EmailWordsLang = 'fr'): string {
  const w = emailWords(lang);
  const seats = packs.map((p) => Number(p.base_capacity || 0)).filter((n) => n > 0);
  if (!seats.length) return '';
  const min = Math.min(...seats);
  const max = Math.max(...seats);
  return min === max ? w.seats(min) : w.seatsRange(min, max);
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
  lang: EmailWordsLang = 'fr',
): TablePackRow[] {
  const w = emailWords(lang);
  const rows = zones.map((z) => {
    const mine = packs.filter((p) => p.zone_id && z.id && String(p.zone_id) === String(z.id));
    if (!mine.length) return null;
    const amounts = mine
      .map((p) => Number(p.base_price || 0) || Number(p.minimum_spend || 0))
      .filter((n) => n > 0);
    const from = amounts.length ? Math.min(...amounts) : 0;
    const bits = [seatsRange(mine, lang)].filter(Boolean);
    // « sans acompte » ne vaut que si TOUTE la zone se règle au club :
    // l'annoncer pour une zone mixte serait une promesse fausse.
    if (mine.every((p) => String(p.payment_mode || '') === 'on_site')) bits.push(w.noDeposit);
    return {
      id: z.id ? String(z.id) : undefined,
      n: String(z.name || w.zoneDefault),
      s: bits.join(' · '),
      // Un seul tarif dans la zone : c'est LE prix, pas un « à partir de ».
      p: from > 0 ? (amounts.length > 1 && Math.max(...amounts) > from ? w.fromShort(formatEuro(from, lang)) : formatEuro(from, lang)) : w.onRequest,
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
  const m = /^(.*?)(€?\s*\d[\d\s.,\u00a0]*\s*€?)$/.exec(s);
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
