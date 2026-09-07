// SMS marketing — constantes et calculs partagés par l'éditeur (club + organisateur).
//
// `smsSizing` / `composeSmsBody` sont le MIROIR EXACT de
// supabase/functions/_shared/sms-text.ts : l'éditeur annonce un nombre de
// crédits, le worker le débite — les deux doivent compter pareil. Toute
// modification d'un côté se répercute de l'autre.

/**
 * Interrupteur « bientôt disponible ». Tant qu'il est à `false`, les pages SMS
 * (club ET organisateur) affichent la bannière et n'autorisent ni envoi, ni
 * test, ni planification, ni achat de crédits — seuls les brouillons se
 * préparent. À passer à `true` une fois le numéro d'envoi Twilio acheté et
 * les webhooks branchés (voir docs/SMS_MARKETING.md).
 */
export const SMS_MARKETING_LIVE = false;

export type SmsLang = 'fr' | 'en' | 'es';
export type SmsSegmentType = 'all' | 'event' | 'not_event' | 'vip';
export type SmsCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed' | 'cancelled';

export type SmsScope =
  | { kind: 'venue'; venueId: string; name: string }
  | { kind: 'organizer'; organizerUserId: string; name: string };

/** Longueur conseillée du texte libre : le nom d'expéditeur + STOP tiennent dans 1 segment GSM. */
export const SMS_BODY_SOFT_LIMIT = 120;
export const SMS_BODY_HARD_LIMIT = 450;
export const SMS_LINK_TOKEN = '{lien}';

export const STOP_SUFFIX: Record<SmsLang, string> = {
  fr: '\nSTOP pour ne plus recevoir',
  en: '\nReply STOP to opt out',
  es: '\nResponde STOP para darte de baja',
};

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = '^{}\\[~]|€';

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
  encoding: 'GSM-7' | 'UCS-2';
  length: number;
  segments: number;
  singleLimit: number;
}

export function smsSizing(text: string): SmsSizing {
  const g = gsm7Length(text);
  if (g >= 0) {
    return { encoding: 'GSM-7', length: g, segments: g === 0 ? 0 : g <= 160 ? 1 : Math.ceil(g / 153), singleLimit: 160 };
  }
  const u = text.length;
  return { encoding: 'UCS-2', length: u, segments: u === 0 ? 0 : u <= 70 ? 1 : Math.ceil(u / 67), singleLimit: 70 };
}

export function normalizeLang(lang: string | null | undefined): SmsLang {
  const l = (lang || 'fr').slice(0, 2).toLowerCase();
  return l === 'en' || l === 'es' ? l : 'fr';
}

export function cleanSenderName(name: string | null | undefined): string {
  return (name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

export function composeSmsBody(
  body: string,
  lang: string | null | undefined,
  senderName: string | null | undefined,
  link?: string | null,
): string {
  const l = normalizeLang(lang);
  let text = (body || '').replace(/\r\n/g, '\n').trim();
  text = text.replace(/\{(lien|link|enlace)\}/gi, link || '').replace(/[ \t]{2,}/g, ' ').trim();
  const sender = cleanSenderName(senderName);
  if (sender && !text.toLowerCase().includes(sender.toLowerCase())) {
    text = `${sender} : ${text}`;
  }
  if (!/\bSTOP\b/i.test(text)) text = text + STOP_SUFFIX[l];
  return text;
}

/** Lien d'exemple de la taille réelle d'un lien suivi (/l/<8 car.>). */
export const SAMPLE_TRACKED_LINK = 'https://yunoapp.eu/l/XXXXXXXX';

/** Crédits par message : pire des langues présentes. */
export function worstSegments(
  body: string,
  bodyI18n: Partial<Record<SmsLang, string>> | null,
  senderName: string | null | undefined,
  hasLink: boolean,
): number {
  const langs: SmsLang[] = ['fr', 'en', 'es'];
  return Math.max(1, ...langs.map((l) => {
    const base = (bodyI18n && bodyI18n[l]) || body;
    return smsSizing(composeSmsBody(base, l, senderName, hasLink ? SAMPLE_TRACKED_LINK : null)).segments;
  }));
}

/** Masque un numéro pour l'affichage en liste : +33 6 •• •• •• 89. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/[^0-9]/g, '');
  if (digits.length < 6) return e164;
  const tail = digits.slice(-2);
  const head = e164.slice(0, Math.min(4, e164.length));
  return `${head} •• •• •• ${tail}`;
}

export function isE164(phone: string): boolean {
  return /^\+[1-9][0-9]{6,14}$/.test(phone);
}
