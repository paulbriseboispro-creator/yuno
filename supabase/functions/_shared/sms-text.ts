// Texte d'un SMS marketing : composition finale, variables, nom d'expéditeur,
// comptage de segments, heures d'envoi.
//
// SOURCE UNIQUE : le front l'importe tel quel (src/lib/smsMarketing.ts
// ré-exporte ce module). L'éditeur annonce un nombre de SMS, le worker le
// débite, Octopush le facture : les trois comptent pareil. Module pur (aucun
// import Deno), testé par src/lib/__tests__/smsMarketing.test.ts.
//
// Règles appliquées SERVEUR, qu'aucun pro ne peut retirer :
//   1. L'annonceur est nommé en tête du message (art. L34-5 CPCE, charte AF2M
//      du 01/03/2026 B.1.1) : si le corps ne contient pas déjà le nom, on le
//      préfixe.
//   2. La mention d'opposition est dans CHAQUE message. Vers un numéro
//      français, c'est « STOP au 30101 », le code court d'Octopush (un message
//      marketing sans elle est refusé, erreur 121) ; ailleurs, le libellé de la
//      langue.
//   3. Le coût = le nombre de segments facturés (GSM-7 : 160 / 153 ; UCS-2 :
//      70 / 67). Un emoji fait basculer tout le message en UCS-2.
//   4. Rien ne part entre 21 h 30 et 8 h (heure de Paris), quels que soient
//      les réglages du pro (charte AF2M, plage des messages promotionnels).

export type SmsLang = "fr" | "en" | "es";

/** Code court STOP d'Octopush (France). */
export const OCTOPUSH_STOP_SHORTCODE = "30101";
export const STOP_MENTION_FR = `STOP au ${OCTOPUSH_STOP_SHORTCODE}`;

/** Mention d'opposition vers un numéro hors de France (pas de code court). */
export const STOP_SUFFIX: Record<SmsLang, string> = {
  fr: "\nSTOP pour ne plus recevoir",
  en: "\nReply STOP to opt out",
  es: "\nResponde STOP para darte de baja",
};

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

/** Longueur GSM-7 (caractères étendus = 2), ou -1 si le texte sort du jeu GSM-7. */
export function gsm7Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) n += 1;
    else if (GSM7_EXT.includes(ch)) n += 2;
    else return -1;
  }
  return n;
}

/** Les caractères hors de l'alphabet SMS standard (ils font passer un SMS à 70 caractères). */
export function nonGsmChars(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXT.includes(ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

export interface SmsSizing {
  encoding: "GSM-7" | "UCS-2";
  length: number;
  segments: number;
  /** Capacité d'un message tenant en un seul segment, dans cet encodage. */
  singleLimit: number;
}

export function smsSizing(text: string): SmsSizing {
  const g = gsm7Length(text);
  if (g >= 0) {
    return { encoding: "GSM-7", length: g, segments: g === 0 ? 0 : g <= 160 ? 1 : Math.ceil(g / 153), singleLimit: 160 };
  }
  // UCS-2 : les unités UTF-16 comptent (un emoji = 2).
  const u = text.length;
  return { encoding: "UCS-2", length: u, segments: u === 0 ? 0 : u <= 70 ? 1 : Math.ceil(u / 67), singleLimit: 70 };
}

export function normalizeLang(lang: string | null | undefined): SmsLang {
  const l = (lang || "fr").slice(0, 2).toLowerCase();
  return l === "en" || l === "es" ? l : "fr";
}

/** Un numéro servi par les opérateurs français (métropole et outre-mer) : la mention « STOP au 30101 » y vaut. */
export function isFrenchNumber(phone: string | null | undefined): boolean {
  return /^\+(33|262|590|594|596|508)[0-9]{6,12}$/.test((phone || "").trim());
}

/** Nom affiché en tête du message : une ligne, 24 caractères max. */
export function cleanSenderName(name: string | null | undefined): string {
  return (name || "").replace(/\s+/g, " ").trim().slice(0, 24);
}

// ── Nom d'expéditeur (ce qui s'affiche à la place du numéro) ────────────────

/** Mots refusés seuls par les opérateurs (charte AF2M) : ils n'identifient personne. */
const GENERIC_SENDERS = new Set([
  "INFO", "INFOS", "SMS", "ALERT", "ALERTE", "NOTIF", "NOTIFICATION", "RDV", "TEST", "SERVICE",
  "PROMO", "PROMOS", "OFFRE", "OFFRES", "MESSAGE", "CONTACT", "NEWS", "VERIF", "CODE", "BANQUE",
]);

export type SenderIdError = "length" | "chars" | "digits" | "generic";

/** Ce qui ne va pas dans un nom d'expéditeur (null = valable) : 3 à 11 lettres ou chiffres, au moins une lettre, pas un mot générique. */
export function senderIdError(id: string | null | undefined): SenderIdError | null {
  const s = (id || "").trim();
  if (s.length < 3 || s.length > 11) return "length";
  if (!/^[A-Za-z0-9]+$/.test(s)) return "chars";
  if (!/[A-Za-z]/.test(s)) return "digits";
  if (GENERIC_SENDERS.has(s.toUpperCase())) return "generic";
  return null;
}

/** Un nom d'expéditeur valable à partir d'un nom libre (« Mad by Night » → « MADBYNIGHT »), ou null. */
export function toSenderId(name: string | null | undefined): string | null {
  const s = (name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
  return senderIdError(s) ? null : s;
}

// ── Variables ───────────────────────────────────────────────────────────────

export interface SmsValues { "prénom"?: string | null; nom_club?: string | null; "soirée"?: string | null; lien?: string | null }

/** Remplace les variables {{…}} connues ; une variable inconnue reste visible. */
export function resolveSmsVars(text: string, vals: SmsValues): string {
  return (text || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, raw: string) => {
    const k = raw.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const key = k === "prenom" || k === "first_name" ? "prénom" : k === "soiree" || k === "event" ? "soirée" : k === "link" ? "lien" : k;
    if (!(key in vals)) return whole;
    return (vals as Record<string, string | null | undefined>)[key] ?? "";
  }).replace(/[ \t]{2,}/g, " ");
}

// ── Composition ─────────────────────────────────────────────────────────────

export interface ComposeOptions {
  /** Le destinataire est-il servi par un opérateur français ? (défaut : oui, Yuno écrit d'abord en France) */
  french?: boolean;
}

/**
 * Corps final tel qu'il part chez le fournisseur : « Nom : message » puis la
 * mention STOP. `link` remplace le jeton {lien} / {link} s'il est présent.
 */
export function composeSmsBody(
  body: string,
  lang: string | null | undefined,
  senderName: string | null | undefined,
  link?: string | null,
  opts: ComposeOptions = {},
): string {
  const l = normalizeLang(lang);
  const french = opts.french !== false;
  let text = (body || "").replace(/\r\n/g, "\n").trim();
  // Jeton de lien : remplacé par l'URL suivie, ou retiré s'il n'y a pas de
  // soirée liée (un « {lien} » brut dans un SMS ferait amateur).
  text = text.replace(/\{(lien|link|enlace)\}/gi, link || "").replace(/[ \t]{2,}/g, " ").trim();
  const sender = cleanSenderName(senderName);
  if (sender && !text.toLowerCase().includes(sender.toLowerCase())) {
    text = `${sender} : ${text}`;
  }
  if (french) {
    if (!new RegExp(`STOP\\s+au\\s+${OCTOPUSH_STOP_SHORTCODE}`, "i").test(text)) text = `${text}\n${STOP_MENTION_FR}`;
  } else if (!/\bSTOP\b/i.test(text)) {
    text = text + STOP_SUFFIX[l];
  }
  return text;
}

// ── Heures d'envoi ──────────────────────────────────────────────────────────

/** Fin de la nuit légale : rien ne part de 21 h 30 à 8 h, heure de Paris. */
export const LEGAL_NIGHT_FROM = 21.5;
export const LEGAL_NIGHT_TO = 8;

export interface ParisClock { hour: number; minute: number; /** 0 = dimanche */ dow: number; ymd: string }

/** Heure de Paris, lue par formatToParts (jamais Number(format()) : « 23 h » en fr-FR). */
export function parisClock(now: Date): ParisClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { hour, minute: Number(get("minute")), dow: Math.max(0, days.indexOf(get("weekday"))), ymd: `${get("year")}-${get("month")}-${get("day")}` };
}

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus). */
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Jour férié en France métropolitaine (« AAAA-MM-JJ »). */
export function isFrenchPublicHoliday(ymd: string): boolean {
  const year = Number(ymd.slice(0, 4));
  if (!year) return false;
  const fixed = ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"];
  if (fixed.includes(ymd.slice(5))) return true;
  const easter = easterSunday(year).getTime();
  const iso = (offsetDays: number) => new Date(easter + offsetDays * 86_400_000).toISOString().slice(0, 10);
  return [iso(1), iso(39), iso(50)].includes(ymd); // lundi de Pâques, Ascension, lundi de Pentecôte
}

export interface SmsQuietRules {
  /** Heures calmes du pro activées pour cet envoi. */
  on: boolean;
  /** Début et fin des heures calmes (heures entières, à cheval sur minuit ou non). */
  from: number;
  to: number;
  /** Ni dimanche ni jour férié. */
  noSunday: boolean;
}

export type SmsHoldReason = "legal_night" | "quiet" | "sunday" | "holiday";

/** Pourquoi un SMS marketing ne part pas maintenant (null = il part). La nuit légale s'applique toujours. */
export function smsHoldReason(now: Date, rules: SmsQuietRules): SmsHoldReason | null {
  const c = parisClock(now);
  const h = c.hour + c.minute / 60;
  if (h >= LEGAL_NIGHT_FROM || h < LEGAL_NIGHT_TO) return "legal_night";
  if (!rules.on) return null;
  if (rules.noSunday && c.dow === 0) return "sunday";
  if (rules.noSunday && isFrenchPublicHoliday(c.ymd)) return "holiday";
  const { from, to } = rules;
  if (from !== to && (from > to ? h >= from || h < to : h >= from && h < to)) return "quiet";
  return null;
}
