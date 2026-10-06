// Les mots des blocs Yuno d'un e-mail, en français, anglais et espagnol.
//
// UNE seule source, importée telle quelle par le Studio (src/lib/email), le
// rendu d'envoi (email-studio-html.ts, send-campaign) et le serveur MCP : un
// e-mail part dans la langue de SA campagne (email_campaigns.language), le
// canevas montre exactement ce qui partira. Le français est la langue par
// défaut et ses chaînes sont celles d'avant (aucun e-mail existant ne change).
//
// Pur, sans dépendance : testé dans src/lib/email/__tests__/words.test.ts.

export type EmailWordsLang = 'fr' | 'en' | 'es';

export function wordsLang(v: unknown): EmailWordsLang {
  return v === 'en' || v === 'es' ? v : 'fr';
}

/** « 12 € » / « 12,50 € » en français et espagnol, « €12 » / « €12.50 » en anglais. */
export function formatEuroIn(amount: number, lang: EmailWordsLang = 'fr'): string {
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return lang === 'en' ? `€${n}` : `${n.replace('.', ',')} €`;
}

export interface EmailWords {
  free: string;
  priceFrom: (price: string) => string;
  minSpend: (price: string) => string;
  onRequest: string;
  soldOutChip: string;
  // Billetterie
  ticketsKicker: string;
  entryKicker: string;
  ticketsCta: string;
  // Liste invités
  guestListRow: string;
  guestListKicker: string;
  guestListCta: string;
  guestListSignup: string;
  glBefore: (time: string) => string;
  glFreeBefore: (time: string) => string;
  glFreeEntry: string;
  freeDrink: string;
  full: string;
  spotsLeft: (n: number) => string;
  // Tables VIP
  tableKicker: string;
  tableCta: string;
  tableDefault: string;
  seats: (n: number) => string;
  seatsRange: (min: number, max: number) => string;
  zoneDefault: string;
  fromShort: (price: string) => string;
  ticketDefault: string;
  bottles: (n: number) => string;
  noDeposit: string;
  tablesLeft: (n: number, scarceThreshold: number) => string;
  // Soirée
  eventCta: string;
  metaDate: string;
  metaVenue: string;
  metaPrice: string;
  // Compte à rebours
  countdownLabel: string;
  countdownOpening: string;
  days: string;
  hours: string;
  minutes: string;
  // Dates
  locale: string;
}

const FR: EmailWords = {
  free: 'Gratuit',
  priceFrom: (p) => `À partir de ${p}`,
  minSpend: (p) => `Min. ${p}`,
  onRequest: 'Sur demande',
  soldOutChip: 'ÉPUISÉ',
  ticketsKicker: 'BILLETTERIE',
  entryKicker: 'ENTRÉE',
  ticketsCta: 'Prendre mes billets',
  guestListRow: 'Liste invités',
  guestListKicker: 'LISTE INVITÉS',
  guestListCta: 'M’inscrire à la liste',
  guestListSignup: 'Inscription gratuite',
  glBefore: (t) => `avant ${t}`,
  glFreeBefore: (t) => `Gratuit avant ${t}`,
  glFreeEntry: 'Entrée gratuite',
  freeDrink: 'boisson offerte',
  full: 'complet',
  spotsLeft: (n) => `${n} place${n > 1 ? 's' : ''} restante${n > 1 ? 's' : ''}`,
  tableKicker: 'Bottle service',
  tableCta: 'Réserver une table',
  tableDefault: 'Table',
  seats: (n) => `${n} pers.`,
  seatsRange: (a, b) => `${a} à ${b} pers.`,
  zoneDefault: 'Carré',
  fromShort: (p) => `dès ${p}`,
  ticketDefault: 'Billet',
  bottles: (n) => `${n} bouteille${n > 1 ? 's' : ''} incluse${n > 1 ? 's' : ''}`,
  noDeposit: 'sans acompte',
  tablesLeft: (n, t) => (n <= 0 ? 'Complet' : n === 1 ? 'Dernière table' : n <= t ? `Plus que ${n} tables` : `${n} tables disponibles`),
  eventCta: "Voir l'événement",
  metaDate: 'Date',
  metaVenue: 'Lieu',
  metaPrice: 'Tarif',
  countdownLabel: 'Plus que',
  countdownOpening: 'Ouverture de la billetterie',
  days: 'JOURS',
  hours: 'HEURES',
  minutes: 'MIN',
  locale: 'fr-FR',
};

const EN: EmailWords = {
  free: 'Free',
  priceFrom: (p) => `From ${p}`,
  minSpend: (p) => `Min. ${p}`,
  onRequest: 'On request',
  soldOutChip: 'SOLD OUT',
  ticketsKicker: 'TICKETS',
  entryKicker: 'ENTRY',
  ticketsCta: 'Get my tickets',
  guestListRow: 'Guest list',
  guestListKicker: 'GUEST LIST',
  guestListCta: 'Join the list',
  guestListSignup: 'Free sign-up',
  glBefore: (t) => `before ${t}`,
  glFreeBefore: (t) => `Free before ${t}`,
  glFreeEntry: 'Free entry',
  freeDrink: 'free drink',
  full: 'full',
  spotsLeft: (n) => `${n} spot${n > 1 ? 's' : ''} left`,
  tableKicker: 'Bottle service',
  tableCta: 'Book a table',
  tableDefault: 'Table',
  seats: (n) => `${n} ${n > 1 ? 'people' : 'person'}`,
  seatsRange: (a, b) => `${a} to ${b} people`,
  zoneDefault: 'Area',
  fromShort: (p) => `from ${p}`,
  ticketDefault: 'Ticket',
  bottles: (n) => `${n} bottle${n > 1 ? 's' : ''} included`,
  noDeposit: 'no deposit',
  tablesLeft: (n, t) => (n <= 0 ? 'Sold out' : n === 1 ? 'Last table' : n <= t ? `Only ${n} tables left` : `${n} tables available`),
  eventCta: 'See the event',
  metaDate: 'Date',
  metaVenue: 'Venue',
  metaPrice: 'Price',
  countdownLabel: 'Only',
  countdownOpening: 'Ticket sales open in',
  days: 'DAYS',
  hours: 'HOURS',
  minutes: 'MIN',
  locale: 'en-GB',
};

const ES: EmailWords = {
  free: 'Gratis',
  priceFrom: (p) => `Desde ${p}`,
  minSpend: (p) => `Mín. ${p}`,
  onRequest: 'Bajo petición',
  soldOutChip: 'AGOTADO',
  ticketsKicker: 'ENTRADAS',
  entryKicker: 'ENTRADA',
  ticketsCta: 'Comprar mis entradas',
  guestListRow: 'Lista de invitados',
  guestListKicker: 'LISTA DE INVITADOS',
  guestListCta: 'Apuntarme a la lista',
  guestListSignup: 'Inscripción gratuita',
  glBefore: (t) => `antes de las ${t}`,
  glFreeBefore: (t) => `Gratis antes de las ${t}`,
  glFreeEntry: 'Entrada gratuita',
  freeDrink: 'consumición incluida',
  full: 'completo',
  spotsLeft: (n) => `${n} plaza${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`,
  tableKicker: 'Bottle service',
  tableCta: 'Reservar una mesa',
  tableDefault: 'Mesa',
  seats: (n) => `${n} pers.`,
  seatsRange: (a, b) => `${a} a ${b} pers.`,
  zoneDefault: 'Zona',
  fromShort: (p) => `desde ${p}`,
  ticketDefault: 'Entrada',
  bottles: (n) => `${n} botella${n > 1 ? 's' : ''} incluida${n > 1 ? 's' : ''}`,
  noDeposit: 'sin depósito',
  tablesLeft: (n, t) => (n <= 0 ? 'Completo' : n === 1 ? 'Última mesa' : n <= t ? `Solo quedan ${n} mesas` : `${n} mesas disponibles`),
  eventCta: 'Ver el evento',
  metaDate: 'Fecha',
  metaVenue: 'Lugar',
  metaPrice: 'Precio',
  countdownLabel: 'Solo quedan',
  countdownOpening: 'Apertura de la venta',
  days: 'DÍAS',
  hours: 'HORAS',
  minutes: 'MIN',
  locale: 'es-ES',
};

const ALL: Record<EmailWordsLang, EmailWords> = { fr: FR, en: EN, es: ES };

export function emailWords(lang: unknown): EmailWords {
  return ALL[wordsLang(lang)];
}

// Les libellés que le Studio pose d'office sur un bloc neuf. Laissés tels
// quels, ils suivent la langue de l'e-mail ; écrits par le pro, ils restent.
type DefaultKey = 'eventCta' | 'ticketsCta' | 'guestListCta' | 'tableCta' | 'tableKicker' | 'guestListKicker' | 'ticketsKicker' | 'entryKicker'
  | 'countdownLabel' | 'countdownOpening';
const DEFAULT_KEYS: DefaultKey[] = ['eventCta', 'ticketsCta', 'guestListCta', 'tableCta', 'tableKicker', 'guestListKicker', 'ticketsKicker', 'entryKicker',
  'countdownLabel', 'countdownOpening'];
const norm = (s: string) => s.normalize('NFKC').replace(/[’']/g, "'").trim().toLowerCase();

/**
 * Un libellé resté au défaut d'UNE des trois langues → le défaut de la langue
 * de l'e-mail. Tout autre texte (écrit par le pro ou par son IA) est rendu
 * tel quel. Vide → vide (le rendu prend alors son défaut).
 */
export function localizeDefaultLabel(label: string | null | undefined, lang: unknown): string {
  const s = String(label ?? '');
  if (!s.trim()) return s;
  const n = norm(s);
  for (const key of DEFAULT_KEYS) {
    for (const w of [FR, EN, ES]) {
      if (norm(w[key]) === n) return emailWords(lang)[key];
    }
  }
  return s;
}

/** « vendredi 9 octobre · 23:00 » dans la langue et le fuseau de la soirée. */
export function eventDateLabel(startAt: string, timezone: string | null | undefined, lang: unknown): string {
  const d = new Date(startAt);
  if (!Number.isFinite(d.getTime())) return '';
  const w = emailWords(lang);
  const tz = timezone || 'Europe/Paris';
  try {
    const day = d.toLocaleDateString(w.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
    const time = d.toLocaleTimeString(w.locale, { hour: '2-digit', minute: '2-digit', timeZone: tz });
    return `${day} · ${time}`;
  } catch {
    return '';
  }
}
