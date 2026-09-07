// Texte d'un SMS marketing : composition finale et comptage de segments.
//
// MIROIR EXACT de src/lib/smsMarketing.ts (côté éditeur). Toute modification
// ici doit être répercutée là-bas : l'éditeur annonce un nombre de crédits,
// le worker le débite — les deux doivent compter pareil.
//
// Trois règles, toutes appliquées SERVEUR (un pro ne peut ni les oublier ni
// les retirer) :
//   1. L'annonceur est nommé (art. L34-5 CPCE : « identité de l'annonceur »).
//      Si le corps ne contient pas déjà le nom de l'expéditeur, on le préfixe.
//   2. La mention d'opposition est présente dans CHAQUE message de prospection
//      (L34-5 al. 4 ; CNIL SAN-2022-017). Idempotent : si le pro a écrit STOP
//      lui-même, on ne double pas.
//   3. Le coût = le nombre de segments réellement facturés par l'opérateur
//      (GSM-7 : 160 / 153 par segment ; UCS-2 : 70 / 67). Un emoji fait
//      basculer tout le message en UCS-2 — le pro le voit dans l'éditeur.

export type SmsLang = "fr" | "en" | "es";

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

/** Nom d'expéditeur nettoyé : une ligne, 24 caractères max. */
export function cleanSenderName(name: string | null | undefined): string {
  return (name || "").replace(/\s+/g, " ").trim().slice(0, 24);
}

/**
 * Corps final tel qu'il part chez Twilio : « Nom : message\nSTOP … ».
 * `link` remplace le jeton {lien} / {link} s'il est présent.
 */
export function composeSmsBody(
  body: string,
  lang: string | null | undefined,
  senderName: string | null | undefined,
  link?: string | null,
): string {
  const l = normalizeLang(lang);
  let text = (body || "").replace(/\r\n/g, "\n").trim();
  // Jeton de lien : remplacé par l'URL suivie, ou retiré s'il n'y a pas de
  // soirée liée (un « {lien} » brut dans un SMS ferait amateur).
  text = text.replace(/\{(lien|link|enlace)\}/gi, link || "").replace(/[ \t]{2,}/g, " ").trim();
  const sender = cleanSenderName(senderName);
  if (sender && !text.toLowerCase().includes(sender.toLowerCase())) {
    text = `${sender} : ${text}`;
  }
  if (!/\bSTOP\b/i.test(text)) text = text + STOP_SUFFIX[l];
  return text;
}
