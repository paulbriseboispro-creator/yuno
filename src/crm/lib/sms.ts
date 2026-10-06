/**
 * Règles de la suite SMS de la Console CRM : variables du message, texte qui
 * part (les mêmes règles que le moteur, importées de
 * supabase/functions/_shared/sms-text.ts : nom d'expéditeur en tête, lien,
 * « STOP au 30101 »), nombre de SMS par contact, coût en Yunits, modèles,
 * vérifications avant l'envoi, heures d'envoi. Pures et testées.
 *
 * L'envoi est OUVERT depuis le 2026-10-08 (Octopush, 35 Yunits par SMS,
 * docs/designs/SMS_PROVIDER_PLAN.md) : send-sms-campaign débite les Yunits,
 * remplit les variables et lit les réglages d'envoi du compte.
 */
import {
  composeSmsBody, LEGAL_NIGHT_FROM, LEGAL_NIGHT_TO, isFrenchPublicHoliday, nonGsmChars, resolveSmsVars, senderIdError,
  smsSizing, toSenderId, type SmsLang, type SmsValues,
} from '@/lib/smsMarketing';

export { resolveSmsVars, senderIdError };
export type { SmsValues };

/** Les écrans SMS de la Console sont montrés (ouverture du 08/10). */
export const CRM_SMS_DISPLAY_LIVE = true;
/** Le moteur SMS est branché pour les comptes CRM (Yunits, variables, réglages, Octopush). */
export const CRM_SMS_ENGINE_READY = true;
/** Les écrans SMS se comportent comme ouverts (programmer, tester, envoyer). */
export const CRM_SMS_SEND_OPEN = CRM_SMS_DISPLAY_LIVE;
/**
 * Pages d'inscription : relances SMS et recueil du numéro pour le SMS. PAS
 * encore : `crm_signup_sends` note un SMS sans l'envoyer, et un numéro recueilli
 * par une page n'entre pas au registre SMS (migration 20261007193500). Tant que
 * c'est faux, ces écrans gardent « Bientôt ».
 */
export const CRM_SMS_SIGNUP_LIVE = false;

/** Variables qu'on insère dans un SMS (le lien à part). */
export const SMS_VARS = ['prénom', 'nom_club', 'soirée'] as const;
export type SmsVar = (typeof SMS_VARS)[number];
export const SMS_LINK = '{{lien}}';

/** Lien d'exemple de la taille réelle d'un lien de soirée (`/go/` d'une soirée Shotgun). */
export const SAMPLE_LINK = 'yunoapp.eu/go/k7Qp2xRa';

export const hasLink = (text: string): boolean => /\{\{\s*(lien|link)\s*\}\}/i.test(text || '');
export const hasFirstName = (text: string): boolean => /\{\{\s*(prénom|prenom|first_name)\s*\}\}/i.test(text || '');

/** Le texte exact qui part : variables remplies, puis la composition du moteur. */
export function smsFinalText(body: string, o: { sender: string | null; lang: SmsLang; vals: SmsValues }): string {
  return composeSmsBody(resolveSmsVars(body, o.vals), o.lang, o.sender, null);
}

export interface SmsCount { length: number; parts: number; encoding: 'GSM-7' | 'UCS-2'; left: number; per: number; bad: string[] }

/** Longueur, nombre de SMS et marge avant le SMS suivant, sur le texte final. */
export function countSms(finalText: string): SmsCount {
  const s = smsSizing(finalText);
  const gsm = s.encoding === 'GSM-7';
  const per = gsm ? 160 : 70;
  const perC = gsm ? 153 : 67;
  const parts = Math.max(1, s.segments);
  const max = parts === 1 ? per : parts * perC;
  return { length: s.length, parts, encoding: s.encoding, left: Math.max(0, max - s.length), per, bad: nonGsmChars(finalText).filter((c) => c.trim()) };
}

const FIX: Record<string, string> = {
  '’': "'", '‘': "'", '«': '"', '»': '"', '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', 'œ': 'oe', 'Œ': 'OE',
  'ç': 'c', 'ê': 'e', 'ë': 'e', 'â': 'a', 'î': 'i', 'ï': 'i', 'ô': 'o', 'û': 'u', 'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u',
  'À': 'A', 'È': 'E', 'Ê': 'E', 'Â': 'A', 'Î': 'I', 'Ô': 'O', 'Û': 'U', 'Ù': 'U', 'Á': 'A', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
  ' ': ' ', ' ': ' ', '°': 'o',
};

/** Remplace les caractères qui coûtent cher par leur équivalent standard ; retire les émojis. */
export function simplifySms(text: string): string {
  return (text || '')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[^\p{ASCII}]/gu, (c) => (nonGsmChars(c).length === 0 ? c : FIX[c] ?? c))
    .replace(/[ \t]{2,}/g, ' ');
}

/** Yunits d'un envoi : contacts × SMS par contact × tarif. */
export const smsCost = (n: number, parts: number, rate: number): number => Math.max(0, n) * Math.max(1, parts) * rate;

/**
 * Yunits d'un envoi à deux tarifs (même règle que le moteur, zone lue sur le
 * numéro) : `net` contacts dont `intl` à l'étranger (tout indicatif hors +33).
 */
export function smsCostSplit(net: number, intl: number, parts: number, rateFr: number, rateIntl: number): number {
  const i = Math.max(0, Math.min(intl, net));
  return smsCost(net - i, parts, rateFr) + smsCost(i, parts, rateIntl);
}

/** Un nom d'expéditeur valable à partir du nom de l'espace : 3 à 11 lettres ou chiffres. */
export function defaultSender(name: string | null | undefined): string {
  return toSenderId(name) ?? 'YUNO';
}
/** Valable pour les opérateurs : 3 à 11 lettres ou chiffres, au moins une lettre, pas un mot générique. */
export const validSender = (s: string): boolean => senderIdError(s) === null;

/** Un numéro saisi (« 06 12 34 56 78 ») en E.164 français par défaut ; null s'il ne tient pas. */
export function toE164(raw: string): string | null {
  const d = (raw || '').replace(/[^0-9+]/g, '');
  if (!d) return null;
  const v = d.startsWith('+') ? d : d.startsWith('00') ? `+${d.slice(2)}` : d.startsWith('0') ? `+33${d.slice(1)}` : `+${d}`;
  return /^\+[1-9][0-9]{6,14}$/.test(v) ? v : null;
}

/** « +33 6 12 34 56 78 » → « 06 12 34 56 78 » (France), sinon tel quel. */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (/^\+33[1-9][0-9]{8}$/.test(e164)) return `0${e164.slice(3)}`.replace(/(\d{2})(?=\d)/g, '$1 ');
  return e164;
}

// ── Modèles ───────────────────────────────────────────────────────────────
export type SmsGoal = 'relancer' | 'annoncer' | 'reveiller' | 'accueillir' | 'fideliser' | 'libre';
export const SMS_GOALS: SmsGoal[] = ['relancer', 'annoncer', 'reveiller', 'accueillir', 'fideliser', 'libre'];
export const SMS_TEMPLATES: { id: string; goal: SmsGoal }[] = [
  { id: 'lastcall', goal: 'relancer' },
  { id: 'rappel', goal: 'relancer' },
  { id: 'avantpremiere', goal: 'annoncer' },
  { id: 'lineup', goal: 'annoncer' },
  { id: 'retrouvailles', goal: 'reveiller' },
  { id: 'bienvenue', goal: 'accueillir' },
  { id: 'merci', goal: 'fideliser' },
  { id: 'vide', goal: 'libre' },
];
export const isSmsTemplate = (id: string | null | undefined): boolean => SMS_TEMPLATES.some((x) => x.id === id);

// ── Vérification avant l'envoi ───────────────────────────────────────────
export type SmsCheckKey = 'txt' | 'lien' | 'enc' | 'len' | 'maj' | 'aud' | 'bal' | 'date' | 'id' | 'stop' | 'from' | 'var';
export interface SmsCheck { key: SmsCheckKey; ok: boolean; crit?: boolean; info?: boolean; fix?: 'msg' | 'audience' | 'recharge' | 'date' | 'identity' }

/** Trop de majuscules : plus de 40 % des lettres sur un texte de plus de 12 lettres. */
export function shouts(text: string): boolean {
  const letters = (text || '').replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length <= 12) return false;
  return (text || '').replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.4;
}

/** `identityOk` : raison sociale + SIRET / RNA / TVA renseignés (exigé par les opérateurs avant tout envoi). */
export function smsChecks(p: { body: string; count: SmsCount; net: number; cost: number; balance: number | null; at: Date | null; now: Date; identityOk?: boolean }): SmsCheck[] {
  const t = (p.body || '').trim();
  return [
    { key: 'txt', ok: t.length > 0, crit: true, fix: 'msg' },
    { key: 'lien', ok: hasLink(t), fix: 'msg' },
    { key: 'enc', ok: p.count.encoding === 'GSM-7', fix: 'msg' },
    { key: 'len', ok: p.count.parts <= 2, fix: 'msg' },
    { key: 'maj', ok: !shouts(t), fix: 'msg' },
    { key: 'aud', ok: p.net > 0, crit: true, fix: 'audience' },
    { key: 'bal', ok: p.balance === null || p.cost <= p.balance, crit: true, fix: 'recharge' },
    { key: 'date', ok: !p.at || p.at.getTime() > p.now.getTime(), crit: true, fix: 'date' },
    { key: 'id', ok: p.identityOk !== false, crit: true, fix: 'identity' },
    { key: 'stop', ok: true },
    { key: 'from', ok: true },
    { key: 'var', ok: hasFirstName(t), info: true, fix: 'msg' },
  ];
}

export type SmsCheckLevel = 'ok' | 'bad' | 'warn' | 'info';
/** ok, bloquant (rouge), conseil (orange) ou simple information. */
export const smsCheckLevel = (c: SmsCheck): SmsCheckLevel => (c.ok ? 'ok' : c.crit ? 'bad' : c.info ? 'info' : 'warn');

/** Ce qu'il manque à un brouillon pour être prêt. */
export type SmsGap = 'body' | 'audience' | 'date';
export function smsDraftGaps(c: { body: string | null; audiences: unknown[] | null | undefined; scheduled_at: string | null }): SmsGap[] {
  const gaps: SmsGap[] = [];
  if (!(c.body || '').trim()) gaps.push('body');
  if (!(Array.isArray(c.audiences) ? c.audiences : []).some((a) => !!a && typeof a === 'object' && (a as { kind?: string }).kind === 'crm')) gaps.push('audience');
  if (!c.scheduled_at) gaps.push('date');
  return gaps;
}

// ── Planification ─────────────────────────────────────────────────────────
export interface SmsQuiet { on: boolean; from: number; to: number; noSunday: boolean }

/** L'heure est-elle dans les heures calmes (de `from` à `to`, à cheval sur minuit ou non) ? */
export function inQuiet(h: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from > to ? h >= from || h < to : h >= from && h < to;
}

/**
 * L'heure réelle de départ : un SMS prévu dans les heures calmes, un dimanche
 * ou un jour férié part au premier créneau autorisé. La nuit de 21 h 30 à 8 h
 * vaut toujours, heures calmes ou non (même règle que le moteur,
 * `smsHoldReason`). Heure locale de l'écran.
 */
export function smsEffectiveAt(at: Date, q: SmsQuiet): { at: Date; shifted: boolean } {
  const d = new Date(at);
  let shifted = false;
  const setHour = (h: number) => d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  const ymd = () => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Heure de réouverture du matin : la fin des heures calmes, jamais avant 8 h.
  const morning = Math.max(LEGAL_NIGHT_TO, q.on && q.from > q.to ? q.to : LEGAL_NIGHT_TO);
  for (let i = 0; i < 12; i++) {
    const h = d.getHours() + d.getMinutes() / 60;
    const rest = q.on && q.noSunday && (d.getDay() === 0 || isFrenchPublicHoliday(ymd()));
    const night = h >= LEGAL_NIGHT_FROM || h < LEGAL_NIGHT_TO;
    const quiet = q.on && inQuiet(h, q.from, q.to);
    if (!rest && !night && !quiet) break;
    shifted = true;
    if (rest) { d.setDate(d.getDate() + 1); setHour(morning); continue; }
    if (quiet && q.from < q.to && !night) { setHour(q.to); continue; }
    // Nuit (ou heures calmes à cheval sur minuit) : le matin même, ou le lendemain.
    if (h >= 12) d.setDate(d.getDate() + 1);
    setHour(morning);
  }
  return { at: d, shifted };
}

/** Meilleurs jours (0 = lundi) et heures d'envoi, par taux de clic, dès 3 SMS partis. */
export function smsBestSlots(rows: { dow: number; hour: number; delivered: number; clicked: number }[]): { days: number[]; hours: number[] } {
  if (rows.length < 3) return { days: [], hours: [] };
  const by = (key: (r: { dow: number; hour: number }) => number) => {
    const m = new Map<number, { d: number; c: number }>();
    for (const r of rows) { const k = key(r); const x = m.get(k) ?? { d: 0, c: 0 }; x.d += r.delivered; x.c += r.clicked; m.set(k, x); }
    return [...m.entries()].filter(([, v]) => v.d > 0).sort((a, b) => b[1].c / b[1].d - a[1].c / a[1].d).map(([k]) => k);
  };
  return { days: by((r) => (r.dow + 6) % 7).slice(0, 2), hours: by((r) => r.hour).slice(0, 2) };
}
