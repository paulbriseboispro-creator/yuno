// SMS marketing — constantes et calculs partagés par l'éditeur (club + organisateur).
//
// La composition, le comptage des SMS, les variables, le nom d'expéditeur et
// les heures d'envoi viennent tels quels de supabase/functions/_shared/sms-text.ts
// (une seule source : l'éditeur annonce le nombre de SMS que le worker débite
// et qu'Octopush facture). Ce fichier n'ajoute que ce qui est propre à l'écran.

import { composeSmsBody, smsSizing } from '../../supabase/functions/_shared/sms-text.ts';

/**
 * Interrupteur « bientôt disponible » de la SUITE (pages SMS club et
 * organisateur de la Billetterie). Tant qu'il est à `false`, elles affichent la
 * bannière et n'autorisent ni envoi, ni test, ni planification, ni achat de
 * crédits — seuls les brouillons se préparent. Le moteur (Octopush) est
 * branché ; l'ouverture côté Suite est une décision de Paul. La Console CRM a
 * son propre interrupteur (`src/crm/lib/sms.ts`).
 */
export const SMS_MARKETING_LIVE = false;

export type SmsLang = 'fr' | 'en' | 'es';
export type SmsSegmentType = 'all' | 'event' | 'not_event' | 'vip' | 'import' | 'contact_segment'
  // Portee plateforme uniquement : l'origine se lit dans le registre email
  // plateforme (resolve_sms_campaign_recipients).
  | 'pros' | 'clients';
export type SmsCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed' | 'cancelled';

export type SmsScope =
  | { kind: 'venue'; venueId: string; name: string }
  | { kind: 'organizer'; organizerUserId: string; name: string }
  /** Marketing de Yuno lui-même (super admin). Aucun crédit : la facture
   *  Octopush est déjà celle de la plateforme. */
  | { kind: 'platform'; name: string };

/** Longueur conseillée du texte libre : le nom d'expéditeur + STOP tiennent dans 1 segment GSM. */
export const SMS_BODY_SOFT_LIMIT = 120;
export const SMS_BODY_HARD_LIMIT = 450;
export const SMS_LINK_TOKEN = '{lien}';

export {
  STOP_SUFFIX, STOP_MENTION_FR, OCTOPUSH_STOP_SHORTCODE, gsm7Length, nonGsmChars, smsSizing, normalizeLang,
  isFrenchNumber, smsTariffZone, cleanSenderName, senderIdError, toSenderId, resolveSmsVars, composeSmsBody,
  parisClock, isFrenchPublicHoliday, smsHoldReason, LEGAL_NIGHT_FROM, LEGAL_NIGHT_TO,
} from '../../supabase/functions/_shared/sms-text.ts';
export type { SmsSizing, SmsValues, SenderIdError, SmsQuietRules, SmsHoldReason, ComposeOptions, SmsTariffZone } from '../../supabase/functions/_shared/sms-text.ts';

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
