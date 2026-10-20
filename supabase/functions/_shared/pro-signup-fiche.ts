// Fiche d'une inscription pro, mise en forme pour le Cockpit de Paul :
// provenance en clair, numéro au format international, constats utiles pour
// l'appel, titre et texte de la notification.
//
// Module PUR (aucune API Deno) : importé par _shared/pro-signup-alerts.ts et
// testé par src/lib/__tests__/proSignupFiche.test.ts. La fiche brute vient de
// la RPC pro_signup_alert_payload (migration 20261103410000).

export type AlertKind =
  | 'account' | 'lead' | 'app_lead' | 'links_lead' | 'contact' | 'stalled' | 'retry' | 'deleted';

type Str = string | null | undefined;

export interface SignupAttempt {
  id?: string; at?: string; kind?: Str; product?: Str; org_name?: Str; phone?: Str; source?: Str;
  utm_source?: Str; referrer_host?: Str; device?: Str; step?: Str;
  account_created_at?: Str; account_deleted?: boolean;
}

export interface SignupOrigin {
  source?: Str; utm_source?: Str; utm_medium?: Str; utm_campaign?: Str; referrer_host?: Str;
  device?: Str; geo_country?: Str; started_at?: Str; account_at?: Str;
  steps?: Record<string, string> | null; step?: Str;
}

/** La fiche brute rendue par la RPC pro_signup_alert_payload. */
export interface RawFiche {
  alert_id?: string;
  kind: AlertKind;
  at?: Str;
  title?: Str;
  message?: Str;
  person?: {
    first_name?: Str; last_name?: Str; full_name?: Str; email?: Str; phone?: Str;
    profile_phone?: Str; lang?: Str;
  };
  org?: {
    kind?: Str; name?: Str; city?: Str; country?: Str; size_band?: Str; frequency?: Str;
    pillars?: string[] | null; current_tool?: Str; next_night?: Str; product?: Str;
    instagram?: Str; message?: Str;
  };
  origin?: SignupOrigin;
  account?: {
    exists?: boolean; user_id?: Str; created_at?: Str; last_sign_in_at?: Str;
    email_confirmed?: boolean; profile_type?: Str; venue_id?: Str; console_opened_at?: Str;
    events?: number; payments?: boolean; live?: boolean; deleted?: boolean;
  };
  attempts?: SignupAttempt[] | null;
  app_leads?: Array<{ at?: Str; name?: Str; club_name?: Str; city?: Str; phone?: Str; message?: Str }> | null;
  stalled?: { step?: Str } | null;
  deleted?: Record<string, unknown> | null;
  admin_url?: Str;
  signups_url?: Str;
}

// ── Téléphone ────────────────────────────────────────────────────────────────

// Indicatif et préfixe national (« 0 ») des pays d'où viennent les pros.
const DIAL: Record<string, { code: string; trunk: boolean; national: number[] }> = {
  FR: { code: '33', trunk: true, national: [9] },
  BE: { code: '32', trunk: true, national: [8, 9] },
  CH: { code: '41', trunk: true, national: [9] },
  LU: { code: '352', trunk: false, national: [6, 8, 9] },
  MC: { code: '377', trunk: false, national: [8, 9] },
  ES: { code: '34', trunk: false, national: [9] },
  IT: { code: '39', trunk: false, national: [9, 10] },
  PT: { code: '351', trunk: false, national: [9] },
  DE: { code: '49', trunk: true, national: [10, 11] },
  GB: { code: '44', trunk: true, national: [10] },
  NL: { code: '31', trunk: true, national: [9] },
  IE: { code: '353', trunk: true, national: [9] },
};

/** Numéro au format international (+33756388760), ou null s'il est illisible.
 *  Un numéro sans indicatif se lit dans le pays donné (France par défaut) :
 *  « 0756388760 » et « 756388760 » deviennent +33756388760. */
export function phoneE164(raw: string | null | undefined, country?: string | null): string | null {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  let digits = t.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (digits.startsWith('+')) {
    const d = digits.slice(1).replace(/\D/g, '');
    // « +33 0 6… » : le 0 national recopié après l'indicatif.
    const fixed = d.startsWith('330') && d.length === 12 ? '33' + d.slice(3) : d;
    return fixed.length >= 8 && fixed.length <= 15 ? '+' + fixed : null;
  }
  const d = digits.replace(/\D/g, '');
  const c = DIAL[(country ?? 'FR').toUpperCase()] ?? DIAL.FR;
  if (c.trunk && d.startsWith('0') && c.national.includes(d.length - 1)) return '+' + c.code + d.slice(1);
  if (c.national.includes(d.length) && !d.startsWith('0')) return '+' + c.code + d;
  return null;
}

/** Affichage : « 07 56 38 87 60 » pour un numéro français, sinon groupé. */
export function phonePretty(e164: string | null | undefined): string | null {
  if (!e164) return null;
  if (e164.startsWith('+33') && e164.length === 12) {
    const n = '0' + e164.slice(3);
    return n.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  }
  // L'indicatif d'un pays connu, sinon on n'invente pas de découpage.
  const digits = e164.slice(1);
  const code = Object.values(DIAL).map((c) => c.code).sort((a, b) => b.length - a.length)
    .find((c) => digits.startsWith(c));
  if (!code) return e164;
  return `+${code} ${digits.slice(code.length).replace(/(\d{3})(?=\d)/g, '$1 ').trim()}`;
}

/** Le dernier chiffre près : deux saisies du même numéro se reconnaissent. */
function phoneKey(e164: string | null): string | null {
  return e164 ? e164.replace(/\D/g, '').slice(-9) : null;
}

// ── Libellés ─────────────────────────────────────────────────────────────────

export function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'club': return 'club';
    case 'organizer': return 'organisateur';
    case 'promoter': return 'promoteur';
    case 'affiliate': return 'agence / promoteur';
    case 'asso': return 'association';
    default: return 'autre';
  }
}

export const STEP_LABEL: Record<string, string> = {
  opened: 'ouverture',
  role: 'profil',
  structure: 'description',
  account: 'compte (mot de passe)',
  lead: 'demande envoyée',
  created: 'compte créé',
  console: 'Console ouverte',
};

const SIZE_LABEL: Record<string, string> = {
  lt200: '< 200 personnes', '200_500': '200-500', '300_800': '300-800', '500_1500': '500-1 500',
  '800_1500': '800-1 500', gt1500: '1 500+', '<200': '< 200', '200-500': '200-500',
  '500-1500': '500-1 500', '1500+': '1 500+',
};
const FREQ_LABEL: Record<string, string> = {
  '1': '1 soirée / mois', '2_4': '2-4 soirées / mois', '5_plus': '5+ soirées / mois', weekly: 'chaque semaine',
};
const NEXT_LABEL: Record<string, string> = {
  week: 'cette semaine', month: 'ce mois-ci', later: 'plus tard', none: 'pas prévue',
};
const TOOL_LABEL: Record<string, string> = {
  shotgun: 'Shotgun', dice: 'DICE', weezevent: 'Weezevent', billetweb: 'Billetweb', eventbrite: 'Eventbrite',
  fourvenues: 'Fourvenues', xceed: 'Xceed', none: 'aucun outil', other: 'autre outil', excel: 'Excel / papier',
};
const PILLAR_LABEL: Record<string, string> = {
  tickets: 'billets', tables: 'tables VIP', guest_list: 'guest list', drinks: 'boissons',
};

const CHANNELS: Array<[RegExp, string]> = [
  [/chatgpt|openai/i, 'ChatGPT'],
  [/perplexity/i, 'Perplexity'],
  [/claude\.ai|anthropic/i, 'Claude'],
  [/gemini|bard/i, 'Gemini'],
  [/copilot|bing/i, 'Bing / Copilot'],
  [/google/i, 'Google'],
  [/instagram|^ig$/i, 'Instagram'],
  [/facebook|fb\.|^fb$/i, 'Facebook'],
  [/tiktok/i, 'TikTok'],
  [/linkedin|lnkd/i, 'LinkedIn'],
  [/whatsapp|wa\.me/i, 'WhatsApp'],
  [/shotgun/i, 'Shotgun'],
  [/yuno_app|yunoapp\.eu/i, "l'app Yuno"],
];

const PAGES: Record<string, string> = {
  landing: 'la landing',
  start: "la page d'inscription",
  start_crm: "la page d'inscription Yuno CRM",
  crm: 'la page Yuno CRM',
  asso: 'la page Associations',
  app_form: "le formulaire « Ouvrir un club » de l'app",
  yuno_links: 'la page Yuno Links (bio Instagram)',
  landing_contact: 'le formulaire de contact de la landing',
};

/** « ChatGPT → la landing », « Google → la landing », « l'app Yuno → la page d'inscription ». */
export function sourceLabel(origin: SignupOrigin | null | undefined): string {
  const o: SignupOrigin = origin ?? {};
  const raw = [o.utm_source, o.referrer_host].filter(Boolean).join(' ');
  const channel = CHANNELS.find(([re]) => re.test(raw))?.[1]
    ?? (o.referrer_host && !/yunoapp\.eu$/i.test(o.referrer_host) ? o.referrer_host : null);
  const src = String(o.source ?? '');
  const page = PAGES[src] ?? (src.startsWith('landing-') ? 'la landing' : src || null);
  if (channel && page) return `${channel} → ${page}`;
  return channel ?? page ?? 'inconnue';
}

// ── La fiche ─────────────────────────────────────────────────────────────────

function minutesBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 60000;
  return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
}

/** « 19/10 à 12h15 », heure de Paris. */
export function parisDateTime(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${parts.day}/${parts.month} à ${parts.hour}h${parts.minute}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}

/** Ce que Paul doit savoir avant d'appeler, en phrases courtes. */
export function callNotes(p: RawFiche): string[] {
  const notes: string[] = [];
  const acc = p.account ?? {};
  const attempts: SignupAttempt[] = Array.isArray(p.attempts) ? p.attempts : [];
  const kind = p.kind;

  if (kind === 'retry') {
    // Depuis le 20/10, la landing reconnaît l'adresse pendant la saisie et propose « Me connecter »
    // ou un lien de connexion par e-mail ; l'alerte ne part que s'il ne s'est pas reconnecté depuis.
    const last = parisDateTime(acc.last_sign_in_at);
    notes.push(
      "A déjà un compte et retente de s'inscrire. Le formulaire lui a proposé « Me connecter » et un lien de connexion par e-mail, "
        + `sans qu'il se reconnecte depuis (${last ? `dernière connexion le ${last}` : 'jamais connecté'}). `
        + "L'aider à entrer dans sa Console : mot de passe oublié, autre adresse, lien pas reçu ?",
    );
  }
  if (kind === 'stalled') {
    const step = p.stalled?.step ?? p.origin?.step;
    notes.push(`Inscription arrêtée à l'étape « ${(step && STEP_LABEL[step]) || step || '?'} » : pas de compte créé.`);
  }
  if (kind === 'deleted') notes.push('A supprimé son compte Yuno lui-même.');

  const deleted = attempts.filter((a) => a.account_deleted);
  if (deleted.length && acc.exists) {
    notes.push(`A supprimé un premier compte puis en a recréé un (même adresse) : ${plural(deleted.length, 'compte supprimé', 'comptes supprimés')}.`);
  }
  if (attempts.length > 1) {
    const unfinished = attempts.filter((a) => !a.account_created_at).length;
    notes.push(`${plural(attempts.length, "parcours d'inscription", "parcours d'inscription")} en 60 jours${unfinished ? `, dont ${unfinished} sans aller au bout` : ''}.`);
  }

  const phones = distinctPhones(p);
  if (phones.length > 1) notes.push(`Numéros différents donnés : ${phones.map((x) => x.pretty).join(' et ')} (une faute de frappe ?).`);
  if (!phones.length) notes.push("Aucun numéro laissé : écrire par e-mail ou chercher son Instagram.");

  if (acc.exists && kind !== 'deleted') {
    if (!acc.console_opened_at && kind === 'account') notes.push("N'a pas encore ouvert sa Console.");
    const events = acc.events ?? 0;
    if (events > 0) notes.push(`A déjà créé ${plural(events, 'soirée', 'soirées')}${acc.payments ? '' : ' mais pas relié ses paiements (Stripe)'}.`);
    else notes.push("Pas encore de soirée créée.");
    if (acc.live) notes.push('Visible en ligne.');
  }
  const next = p.org?.next_night;
  if (next === 'week') notes.push('Prochaine soirée CETTE SEMAINE : appeler vite.');
  if (Array.isArray(p.app_leads) && p.app_leads.length) {
    notes.push(`A aussi rempli ${plural(p.app_leads.length, 'fois', 'fois')} le formulaire « Ouvrir un club » de l'app.`);
  }
  return notes;
}

/** Les numéros donnés partout (parcours, formulaire, profil), sans doublon. */
export function distinctPhones(p: RawFiche): Array<{ e164: string; pretty: string }> {
  const country = p.org?.country ?? p.origin?.geo_country ?? 'FR';
  const raws: Str[] = [
    p.person?.phone,
    p.person?.profile_phone,
    ...(Array.isArray(p.attempts) ? p.attempts.map((a) => a.phone) : []),
    ...(Array.isArray(p.app_leads) ? p.app_leads.map((a) => a.phone) : []),
  ];
  const seen = new Set<string>();
  const out: Array<{ e164: string; pretty: string }> = [];
  for (const r of raws) {
    const e = phoneE164(r, country);
    const k = phoneKey(e);
    if (!e || !k || seen.has(k)) continue;
    seen.add(k);
    out.push({ e164: e, pretty: phonePretty(e) ?? e });
  }
  return out;
}

const PUSH_TITLE: Record<AlertKind, (p: RawFiche) => string> = {
  account: (p) => `🆕 ${p.org?.kind === 'club' ? 'Nouveau club inscrit' : 'Nouvel organisateur inscrit'}${p.org?.product === 'crm' ? ' (Yuno CRM)' : ''}`,
  lead: () => '📩 Nouvelle demande pro',
  app_lead: () => "📩 Demande « Ouvrir un club » (app)",
  links_lead: () => '📩 Demande pro (Yuno Links)',
  contact: () => '✉️ Message depuis la landing',
  stalled: () => '⚠️ Inscription pro bloquée',
  retry: () => '⚠️ Un pro inscrit n’arrive plus à entrer',
  deleted: () => '🗑️ Compte pro supprimé',
};

/** Liens de recherche tout faits : quand le web ne dit rien de net, Paul
 *  vérifie lui-même en un tap (Instagram et Shotgun passent par Google, qui
 *  n'exige pas de connexion). */
export function searchLinks(p: RawFiche): Array<{ label: string; url: string }> {
  const name = String(p.org?.name ?? '').trim();
  if (!name || p.kind === 'deleted') return [];
  const q = `"${name}"${p.org?.city ? ` ${p.org.city}` : ''}`;
  const g = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return [
    { label: 'Google', url: g(q) },
    { label: 'Instagram', url: g(`site:instagram.com ${q}`) },
    { label: 'Shotgun', url: g(`site:shotgun.live ${q}`) },
  ];
}

export type Fiche = RawFiche & {
  labels: {
    kind: string; source: string; size: string | null; frequency: string | null; next_night: string | null;
    tool: string | null; pillars: string | null; step: string | null; duration_min: number | null;
  };
  phones: Array<{ e164: string; pretty: string }>;
  notes: string[];
  search_links: Array<{ label: string; url: string }>;
  push: { title: string; body: string };
};

/** Fiche brute (RPC) → fiche prête pour le Cockpit. */
export function enrichFiche(p: RawFiche): Fiche {
  const org = p.org ?? {};
  const person = p.person ?? {};
  const origin: SignupOrigin = p.origin ?? {};
  const phones = distinctPhones(p);
  const who = person.full_name || person.email || 'Quelqu’un';
  const where = org.city ? ` (${org.city})` : '';
  const orgName = org.name || '?';
  const source = sourceLabel(origin);
  const phone = phones[0]?.pretty;

  let body: string;
  const stalledStep = p.stalled?.step ?? origin.step;
  switch (p.kind) {
    case 'retry':
      body = `${who} (${orgName}) a déjà un compte, ne s'est pas reconnecté malgré « Me connecter » et le lien proposés${phone ? ` · ${phone}` : ''}`;
      break;
    case 'stalled':
      body = `${orgName}${where} · ${who} · arrêté à « ${(stalledStep && STEP_LABEL[stalledStep]) || '?'} »${phone ? ` · ${phone}` : ''}`;
      break;
    case 'deleted':
      body = `${orgName}${where} · ${who} a supprimé son compte`;
      break;
    default:
      body = `${orgName}${where} · ${who}${phone ? ` · ${phone}` : ''} · via ${source}`;
  }

  return {
    ...p,
    labels: {
      kind: kindLabel(org.kind),
      source,
      size: org.size_band ? SIZE_LABEL[org.size_band] ?? org.size_band : null,
      frequency: org.frequency ? FREQ_LABEL[org.frequency] ?? org.frequency : null,
      next_night: org.next_night ? NEXT_LABEL[org.next_night] ?? org.next_night : null,
      tool: org.current_tool ? TOOL_LABEL[org.current_tool] ?? org.current_tool : null,
      pillars: Array.isArray(org.pillars) && org.pillars.length
        ? org.pillars.map((x) => PILLAR_LABEL[x] ?? x).join(', ') : null,
      step: origin.step ? STEP_LABEL[origin.step] ?? origin.step : null,
      duration_min: minutesBetween(origin.started_at, origin.account_at),
    },
    phones,
    notes: callNotes(p),
    search_links: searchLinks(p),
    push: { title: PUSH_TITLE[p.kind]?.(p) ?? 'Nouvelle inscription', body: body.slice(0, 180) },
  };
}

/** Ce qu'on donne à la recherche web : la structure, jamais le téléphone ni
 *  l'adresse e-mail (seulement son domaine quand ce n'est pas une messagerie
 *  grand public, il trahit souvent le site de la structure). */
const WEBMAIL = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|free|orange|wanadoo|sfr|laposte|bbox|neuf|yandex|mail|hotmail\.co)\./i;
export function researchInput(p: RawFiche): {
  name: string; city: string | null; country: string | null; kind: string; person: string | null; domain: string | null;
} | null {
  const name = String(p.org?.name ?? '').trim();
  if (!name || name.length < 2 || p.kind === 'deleted') return null;
  const domain = String(p.person?.email ?? '').split('@')[1]?.toLowerCase() || null;
  return {
    name,
    city: p.org?.city ?? null,
    country: p.org?.country ?? p.origin?.geo_country ?? null,
    kind: kindLabel(p.org?.kind),
    person: p.person?.full_name ?? null,
    domain: domain && !WEBMAIL.test(domain) ? domain : null,
  };
}
