/**
 * Les mots de la page /stats/<jeton> d'un lien partenaire et du message qui
 * l'envoie (WhatsApp / email).
 *
 * Ils ne passent pas par le dictionnaire de l'interface : la page parle la
 * langue CHOISIE PAR LE PRO à la création du lien
 * (`tracked_links.partner_language`, migration 20261025100000), pas celle du
 * téléphone du visiteur, et la Console écrit le message dans la langue du
 * partenaire sans charger un second dictionnaire (~1 Mo par langue).
 * Triplets [EN, FR, ES] côte à côte : une traduction manquante ne compile pas.
 */

export const PARTNER_LANGUAGES = ['en', 'fr', 'es'] as const;
export type PartnerLanguage = (typeof PARTNER_LANGUAGES)[number];

/** Le nom de chaque langue dans cette langue (sélecteur de la Console). */
export const PARTNER_LANGUAGE_NAMES: Record<PartnerLanguage, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

export function isPartnerLanguage(value: unknown): value is PartnerLanguage {
  return typeof value === 'string' && (PARTNER_LANGUAGES as readonly string[]).includes(value);
}

/** Une langue lue en base ou dans un cache : tout ce qui n'est pas en / fr / es devient `fallback`. */
export function toPartnerLanguage(value: unknown, fallback: PartnerLanguage = 'en'): PartnerLanguage {
  return isPartnerLanguage(value) ? value : fallback;
}

/** Locale des dates et des montants de la page. */
export function partnerLocale(lang: PartnerLanguage): string {
  return lang === 'en' ? 'en-GB' : lang === 'es' ? 'es-ES' : 'fr-FR';
}

const INDEX: Record<PartnerLanguage, 0 | 1 | 2> = { en: 0, fr: 1, es: 2 };

const WORDS = {
  // Message d'envoi (Console)
  shareMessage: [
    'Hi {name}! Here is your link for {event}: {link}\nFollow your sales live here (keep it for yourself): {page}',
    'Salut {name} ! Voici ton lien pour {event} : {link}\nSuis tes ventes en direct ici (garde-la pour toi) : {page}',
    '¡Hola {name}! Aquí tienes tu enlace para {event}: {link}\nSigue tus ventas en directo aquí (guárdala para ti): {page}',
  ],
  shareSubject: ['Your link for {event}', 'Ton lien pour {event}', 'Tu enlace para {event}'],

  // Page /stats/<jeton>
  private: ['Private page', 'Page privée', 'Página privada'],
  errorTitle: ['Something went wrong', 'Un souci de connexion', 'Algo ha fallado'],
  errorBody: [
    'Your stats could not be loaded. Check your connection and try again.',
    'Tes chiffres n\'ont pas pu être chargés. Vérifie ta connexion et réessaie.',
    'No se han podido cargar tus cifras. Revisa tu conexión y vuelve a intentarlo.',
  ],
  closedTitle: ['This page is closed', 'Cette page est fermée', 'Esta página está cerrada'],
  closedBody: [
    '{event} is over and its stats page has closed. Ask the organizer for your final numbers.',
    '{event} est terminée et sa page de stats est fermée. Demande tes chiffres finaux à l\'organisateur.',
    '{event} ha terminado y su página de estadísticas está cerrada. Pide tus cifras finales al organizador.',
  ],
  notFoundTitle: ['Link not found', 'Lien introuvable', 'Enlace no encontrado'],
  notFoundBody: [
    'This page doesn\'t exist or has been replaced. Ask the organizer for your new link.',
    'Cette page n\'existe pas ou a été remplacée. Demande ton nouveau lien à l\'organisateur.',
    'Esta página no existe o ha sido sustituida. Pide tu nuevo enlace al organizador.',
  ],
  retry: ['Try again', 'Réessayer', 'Reintentar'],
  yourNight: ['Your night', 'Ta soirée', 'Tu noche'],
  helloSales: [
    'Hi {name}. Here is what your link brought in for this night.',
    'Salut {name}. Voici ce que ton lien a rapporté pour cette soirée.',
    'Hola {name}. Esto es lo que tu enlace ha conseguido para esta noche.',
  ],
  helloEmpty: [
    'Hi {name}. Your link is ready: every purchase made through it shows up here, live.',
    'Salut {name}. Ton lien est prêt : chaque achat fait par lui s\'affiche ici, en direct.',
    'Hola {name}. Tu enlace está listo: cada compra hecha con él aparece aquí, en directo.',
  ],
  yourLink: ['Your link', 'Ton lien', 'Tu enlace'],
  inactive: [
    'This link has been paused by the organizer.',
    'Ce lien a été mis en pause par l\'organisateur.',
    'El organizador ha pausado este enlace.',
  ],
  copied: ['Copied', 'Copié', 'Copiado'],
  copy: ['Copy', 'Copier', 'Copiar'],
  share: ['Share', 'Partager', 'Compartir'],
  shareText: ['Tickets for {event}', 'Billets pour {event}', 'Entradas para {event}'],
  yourNumbers: ['Your numbers', 'Tes chiffres', 'Tus cifras'],
  live: ['Live', 'En direct', 'En directo'],
  clicks: ['Clicks', 'Clics', 'Clics'],
  sales: ['Sales', 'Ventes', 'Ventas'],
  revenue: ['Revenue', 'CA', 'Ingresos'],
  conversion: ['Conversion', 'Conversion', 'Conversión'],
  numbersHint: ['{sales} purchases from {clicks} clicks.', '{sales} achats sur {clicks} clics.', '{sales} compras de {clicks} clics.'],
  revenueHint: [
    'Revenue is the value of the tickets, excluding service fees.',
    'Le CA est la valeur des billets, hors frais de service.',
    'Los ingresos son el valor de las entradas, sin gastos de servicio.',
  ],
  last7: ['Clicks · last 7 days', 'Clics · 7 derniers jours', 'Clics · últimos 7 días'],
  yourSales: ['Your sales', 'Tes ventes', 'Tus ventas'],
  noSalesTitle: ['No sales yet', 'Pas encore de vente', 'Todavía no hay ventas'],
  noSalesBody: [
    'A story with the link sticker sells the most. Your first sale will show up here with the buyer\'s first name.',
    'Une story avec le sticker lien, c\'est ce qui vend le plus. Ta première vente s\'affichera ici avec le prénom de l\'acheteur.',
    'Una story con el sticker de enlace es lo que más vende. Tu primera venta aparecerá aquí con el nombre del comprador.',
  ],
  keepPrivate: [
    'This page is yours: keep it to yourself. It stays open until {date}.',
    'Cette page est à toi : garde-la pour toi. Elle reste ouverte jusqu\'au {date}.',
    'Esta página es tuya: guárdala para ti. Sigue abierta hasta el {date}.',
  ],
  partnerOf: ['Partner of {owner} · via Yuno', 'Partenaire de {owner} · via Yuno', 'Partner de {owner} · vía Yuno'],
  'kind.table': ['VIP table', 'Table VIP', 'Mesa VIP'],
  'kind.guestlist': ['Guest list', 'Guest list', 'Guest list'],
  'kind.order': ['Order', 'Commande', 'Pedido'],
  guests: ['{n} guests', '{n} pers.', '{n} pers.'],
  tickets: ['{n} tickets', '{n} billets', '{n} entradas'],
  ticket: ['{n} ticket', '{n} billet', '{n} entrada'],
  someone: ['A customer', 'Un client', 'Un cliente'],
} as const satisfies Record<string, readonly [string, string, string]>;

export type PartnerWordKey = keyof typeof WORDS;
export type PartnerWords = (key: PartnerWordKey) => string;

/** Les mots d'une langue : `w('yourLink')` → « Your link » / « Ton lien » / « Tu enlace ». */
export function partnerWords(lang: PartnerLanguage): PartnerWords {
  const i = INDEX[lang];
  return (key) => WORDS[key][i];
}

/** Toutes les clés (test de parité des trois langues). */
export const PARTNER_WORD_KEYS = Object.keys(WORDS) as PartnerWordKey[];
