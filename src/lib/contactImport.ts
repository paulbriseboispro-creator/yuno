// Lecture d'une base client apportée par un pro — import UNIFIÉ.
//
// Le fichier de Kevin (export de son ancienne billetterie) porte 18 colonnes :
// prénom, nom, email, téléphone, pays, département, ville, code postal, zone,
// âge, genre, opt-in newsletter, date d'ajout, dernier achat, total dépensé,
// nombre de soirées. L'ancien import n'en lisait que trois (email + nom) et il
// fallait réimporter le même fichier une seconde fois pour les SMS.
//
// Ce module lit TOUT ce qu'il reconnaît, typé et normalisé (E.164, ISO-2,
// dates ISO, nombres), et rend une ligne par personne avec son email ET/OU son
// numéro. Une ligne est exploitable dès qu'elle porte l'un des deux. Le
// serveur (`import_contact_list`) retype chaque champ : ici c'est du confort
// et de la lecture, jamais de la sécurité.
//
// Aucune I/O, aucun appel réseau : le rapport de lecture est instantané.

import { isValidEmail, splitCsvLine } from '@/lib/emailImport';
import { IMPORT_COUNTRIES, normalizePhone, type CountryOption } from '@/lib/smsImport';

export type Gender = 'female' | 'male' | 'other';

export interface ContactRow {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  country_code?: string;
  country?: string;
  region?: string;
  city?: string;
  postal_code?: string;
  zone?: string;
  age?: number;
  gender?: Gender;
  newsletter_opt_in?: boolean;
  added_at?: string;
  last_purchase_at?: string;
  total_spent?: number;
  event_count?: number;
}

export type ContactField =
  | 'email' | 'phone' | 'firstName' | 'lastName' | 'fullName' | 'country' | 'region' | 'city'
  | 'postalCode' | 'zone' | 'age' | 'birthDate' | 'gender' | 'newsletter' | 'addedAt'
  | 'lastPurchaseAt' | 'totalSpent' | 'eventCount';

export interface ContactParseResult {
  rows: ContactRow[];
  /** Lignes non vides qui ne portaient ni email ni numéro exploitable. */
  invalid: string[];
  duplicates: number;
  totalRows: number;
  /** En-têtes reconnus : champ → libellé d'origine dans le fichier. */
  detected: Partial<Record<ContactField, string>>;
  stats: {
    emails: number;
    phones: number;
    both: number;
    withLocation: number;
    withSpend: number;
    withEvents: number;
    withLastPurchase: number;
    withAge: number;
    withGender: number;
  };
}

// ── En-têtes reconnus (FR / EN / ES, exports Shotgun, Dice, Weezevent, Mailchimp, Brevo…) ──
const H: Record<ContactField, string[]> = {
  email: ['email', 'e-mail', 'mail', 'courriel', 'adresse email', 'adresse e-mail', 'email address', 'correo', 'correo electronico', 'correo electrónico', 'e mail'],
  phone: ['telephone', 'téléphone', 'tel', 'tél', 'phone', 'phone number', 'mobile', 'portable', 'gsm', 'numero', 'numéro', 'numero de telephone', 'num', 'cellphone', 'cell', 'movil', 'móvil', 'telefono', 'teléfono', 'sms', 'whatsapp', 'mobile phone'],
  firstName: ['prenom', 'prénom', 'first name', 'firstname', 'first_name', 'given name', 'nombre', 'fname'],
  lastName: ['nom', 'nom de famille', 'last name', 'lastname', 'last_name', 'surname', 'family name', 'apellido', 'apellidos', 'lname'],
  fullName: ['nom complet', 'full name', 'fullname', 'name', 'nombre completo', 'contact', 'client', 'customer'],
  country: ['pays', 'country', 'pais', 'país', 'country code', 'code pays', 'nationalite', 'nationalité'],
  region: ['departement', 'département', 'region', 'région', 'state', 'province', 'provincia', 'departamento', 'comunidad', 'county'],
  city: ['ville', 'city', 'ciudad', 'commune', 'town', 'localite', 'localité', 'municipio'],
  postalCode: ['code postal', 'cp', 'zip', 'zip code', 'zipcode', 'postal code', 'postcode', 'codigo postal', 'código postal'],
  zone: ['zone geographique', 'zone géographique', 'zone', 'area', 'market', 'metropole', 'métropole', 'agglomeration', 'agglomération', 'region metropolitaine', 'zona', 'zona geografica', 'zona geográfica'],
  age: ['age', 'âge', 'edad'],
  birthDate: ['date de naissance', 'naissance', 'birthdate', 'birth date', 'birthday', 'date of birth', 'dob', 'fecha de nacimiento', 'nacimiento'],
  gender: ['genre', 'sexe', 'gender', 'sex', 'genero', 'género', 'sexo', 'civilite', 'civilité'],
  newsletter: ['abonne a la newsletter', 'abonné à la newsletter', 'newsletter', 'opt-in', 'optin', 'opt in', 'subscribed', 'abonne', 'abonné', 'suscrito', 'suscrito al boletin', 'suscrito al boletín', 'consent', 'consentement', 'marketing', 'email marketing', 'accepte les emails', 'newsletter subscriber'],
  addedAt: ['ajoute', 'ajouté', 'date d ajout', 'date d\'ajout', 'added', 'added at', 'created', 'created at', 'creation', 'création', 'date de creation', 'date de création', 'inscrit le', 'inscription', 'date d inscription', 'signup date', 'signed up', 'premier achat', 'first purchase', 'first order', 'fecha de alta', 'alta', 'creado', 'primera compra'],
  lastPurchaseAt: ['dernier achat', 'derniere commande', 'dernière commande', 'derniere visite', 'dernière visite', 'last purchase', 'last order', 'last event', 'last visit', 'last seen', 'last activity', 'derniere activite', 'dernière activité', 'ultima compra', 'última compra', 'ultimo pedido', 'último pedido', 'ultima visita', 'última visita', 'last ticket', 'dernier billet', 'dernier evenement', 'dernier évènement', 'dernier événement'],
  totalSpent: ['total depense', 'total dépensé', 'depense', 'dépense', 'depenses', 'dépenses', 'montant', 'montant total', 'total spent', 'spent', 'spend', 'total spend', 'revenue', 'ltv', 'lifetime value', 'chiffre d affaires', 'ca', 'total gastado', 'gasto', 'gasto total', 'importe', 'importe total', 'amount', 'total amount', 'total ttc', 'panier', 'total'],
  eventCount: ['total evenements', 'total évènements', 'total événements', 'evenements', 'évènements', 'événements', 'nombre d evenements', 'nombre d\'évènements', 'nb evenements', 'nb soirees', 'soirees', 'soirées', 'nombre de soirees', 'visites', 'nombre de visites', 'events', 'total events', 'event count', 'number of events', 'visits', 'orders', 'commandes', 'nombre de commandes', 'tickets', 'billets', 'nombre de billets', 'eventos', 'total eventos', 'visitas', 'pedidos', 'entradas', 'attendance'],
};

// Ordre de résolution : les libellés composés avant les mots courts (« total
// dépensé » avant « total », « code postal » avant « cp »).
const FIELD_ORDER: ContactField[] = [
  'email', 'phone', 'firstName', 'lastName', 'fullName', 'postalCode', 'zone', 'country', 'region', 'city',
  'birthDate', 'age', 'gender', 'newsletter', 'lastPurchaseAt', 'addedAt', 'eventCount', 'totalSpent',
];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/["'’]/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-./()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const H_NORM: Record<ContactField, Set<string>> = Object.fromEntries(
  (Object.keys(H) as ContactField[]).map((f) => [f, new Set(H[f].map(normalizeHeader))]),
) as Record<ContactField, Set<string>>;

function detectDelimiter(line: string): string {
  let best = ','; let bestCount = 0;
  for (const d of [';', ',', '\t', '|']) {
    const count = splitCsvLine(line, d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function splitFullName(full: string): { first?: string; last?: string } {
  const clean = full.replace(/\s+/g, ' ').trim();
  if (!clean) return {};
  if (clean.includes(',')) {
    const [lastPart, ...rest] = clean.split(',');
    const firstPart = rest.join(',').trim();
    if (firstPart) return { first: firstPart, last: lastPart.trim() || undefined };
    return { first: lastPart.trim() };
  }
  const parts = clean.split(' ');
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function extractAngleBracket(cell: string): { email: string; name?: string } | null {
  const m = cell.match(/^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (!m) return null;
  return { email: m[2], name: m[1]?.replace(/^["']|["']$/g, '').trim() || undefined };
}

function looksLikePhone(cell: string): boolean {
  const digits = cell.replace(/[^0-9]/g, '');
  return digits.length >= 6 && digits.length <= 15 && /^[\s+0-9().\-~'"]+$/.test(cell.trim());
}

// ── Pays : nom (FR/EN/ES) ou indicatif → ISO-2 ──────────────────────────────
const COUNTRY_NAMES: Record<string, string> = {
  france: 'FR', fr: 'FR', francia: 'FR',
  espagne: 'ES', spain: 'ES', espana: 'ES', es: 'ES',
  belgique: 'BE', belgium: 'BE', belgica: 'BE', be: 'BE',
  suisse: 'CH', switzerland: 'CH', suiza: 'CH', ch: 'CH', schweiz: 'CH',
  italie: 'IT', italy: 'IT', italia: 'IT', it: 'IT',
  allemagne: 'DE', germany: 'DE', alemania: 'DE', de: 'DE', deutschland: 'DE',
  portugal: 'PT', pt: 'PT',
  'pays bas': 'NL', netherlands: 'NL', 'paises bajos': 'NL', nl: 'NL', holland: 'NL', hollande: 'NL', nederland: 'NL',
  'royaume uni': 'GB', 'united kingdom': 'GB', uk: 'GB', gb: 'GB', 'reino unido': 'GB', angleterre: 'GB', england: 'GB', 'great britain': 'GB',
  luxembourg: 'LU', lu: 'LU', luxemburgo: 'LU',
  maroc: 'MA', morocco: 'MA', marruecos: 'MA', ma: 'MA',
  algerie: 'DZ', algeria: 'DZ', argelia: 'DZ',
  tunisie: 'TN', tunisia: 'TN', tunez: 'TN',
  'etats unis': 'US', 'united states': 'US', usa: 'US', us: 'US', 'estados unidos': 'US', 'united states of america': 'US', 'etats unis d amerique': 'US',
  canada: 'CA', ca: 'CA',
  mexique: 'MX', mexico: 'MX', mx: 'MX',
  bresil: 'BR', brazil: 'BR', brasil: 'BR', br: 'BR',
  argentine: 'AR', argentina: 'AR',
  colombie: 'CO', colombia: 'CO',
  chili: 'CL', chile: 'CL',
  perou: 'PE', peru: 'PE',
  irlande: 'IE', ireland: 'IE', irlanda: 'IE', ie: 'IE',
  autriche: 'AT', austria: 'AT', at: 'AT',
  danemark: 'DK', denmark: 'DK', dinamarca: 'DK',
  suede: 'SE', sweden: 'SE', suecia: 'SE',
  norvege: 'NO', norway: 'NO', noruega: 'NO',
  finlande: 'FI', finland: 'FI', finlandia: 'FI',
  pologne: 'PL', poland: 'PL', polonia: 'PL',
  grece: 'GR', greece: 'GR', grecia: 'GR',
  turquie: 'TR', turkey: 'TR', turquia: 'TR',
  'republique tcheque': 'CZ', czechia: 'CZ', 'czech republic': 'CZ', chequia: 'CZ',
  hongrie: 'HU', hungary: 'HU', hungria: 'HU',
  roumanie: 'RO', romania: 'RO', rumania: 'RO',
  croatie: 'HR', croatia: 'HR', croacia: 'HR',
  russie: 'RU', russia: 'RU', rusia: 'RU',
  ukraine: 'UA', ucrania: 'UA',
  israel: 'IL',
  liban: 'LB', lebanon: 'LB', libano: 'LB',
  'emirats arabes unis': 'AE', 'united arab emirates': 'AE', uae: 'AE', dubai: 'AE', 'emiratos arabes unidos': 'AE',
  'arabie saoudite': 'SA', 'saudi arabia': 'SA',
  qatar: 'QA',
  egypte: 'EG', egypt: 'EG', egipto: 'EG',
  senegal: 'SN',
  'cote d ivoire': 'CI', 'ivory coast': 'CI',
  cameroun: 'CM', cameroon: 'CM',
  nigeria: 'NG',
  'afrique du sud': 'ZA', 'south africa': 'ZA', sudafrica: 'ZA',
  inde: 'IN', india: 'IN',
  chine: 'CN', china: 'CN',
  japon: 'JP', japan: 'JP',
  'coree du sud': 'KR', 'south korea': 'KR', korea: 'KR',
  australie: 'AU', australia: 'AU', au: 'AU',
  'nouvelle zelande': 'NZ', 'new zealand': 'NZ',
  singapour: 'SG', singapore: 'SG',
  thailande: 'TH', thailand: 'TH',
  indonesie: 'ID', indonesia: 'ID',
  vietnam: 'VN',
  philippines: 'PH',
  malaisie: 'MY', malaysia: 'MY',
  'hong kong': 'HK',
  reunion: 'RE', 'la reunion': 'RE',
  guadeloupe: 'GP', martinique: 'MQ', guyane: 'GF', mayotte: 'YT',
  'nouvelle caledonie': 'NC', 'polynesie francaise': 'PF', tahiti: 'PF',
  monaco: 'MC', andorre: 'AD', andorra: 'AD', malte: 'MT', malta: 'MT', chypre: 'CY', cyprus: 'CY',
  islande: 'IS', iceland: 'IS', estonie: 'EE', estonia: 'EE', lettonie: 'LV', latvia: 'LV', lituanie: 'LT', lithuania: 'LT',
  slovaquie: 'SK', slovakia: 'SK', slovenie: 'SI', slovenia: 'SI', bulgarie: 'BG', bulgaria: 'BG', serbie: 'RS', serbia: 'RS',
};

// Indicatifs → ISO-2 (les plus longs d'abord à la résolution).
const DIAL_CODES: Array<[string, string]> = [
  ['1', 'US'], ['7', 'RU'], ['20', 'EG'], ['27', 'ZA'], ['30', 'GR'], ['31', 'NL'], ['32', 'BE'], ['33', 'FR'], ['34', 'ES'],
  ['36', 'HU'], ['39', 'IT'], ['40', 'RO'], ['41', 'CH'], ['43', 'AT'], ['44', 'GB'], ['45', 'DK'], ['46', 'SE'], ['47', 'NO'],
  ['48', 'PL'], ['49', 'DE'], ['51', 'PE'], ['52', 'MX'], ['53', 'CU'], ['54', 'AR'], ['55', 'BR'], ['56', 'CL'], ['57', 'CO'],
  ['58', 'VE'], ['60', 'MY'], ['61', 'AU'], ['62', 'ID'], ['63', 'PH'], ['64', 'NZ'], ['65', 'SG'], ['66', 'TH'], ['81', 'JP'],
  ['82', 'KR'], ['84', 'VN'], ['86', 'CN'], ['90', 'TR'], ['91', 'IN'], ['92', 'PK'], ['98', 'IR'],
  ['212', 'MA'], ['213', 'DZ'], ['216', 'TN'], ['221', 'SN'], ['225', 'CI'], ['234', 'NG'], ['237', 'CM'],
  ['262', 'RE'], ['351', 'PT'], ['352', 'LU'], ['353', 'IE'], ['354', 'IS'], ['355', 'AL'], ['356', 'MT'], ['357', 'CY'],
  ['358', 'FI'], ['359', 'BG'], ['370', 'LT'], ['371', 'LV'], ['372', 'EE'], ['373', 'MD'], ['374', 'AM'], ['375', 'BY'],
  ['376', 'AD'], ['377', 'MC'], ['380', 'UA'], ['381', 'RS'], ['385', 'HR'], ['386', 'SI'], ['387', 'BA'], ['389', 'MK'],
  ['420', 'CZ'], ['421', 'SK'], ['590', 'GP'], ['594', 'GF'], ['596', 'MQ'], ['687', 'NC'], ['689', 'PF'],
  ['852', 'HK'], ['961', 'LB'], ['962', 'JO'], ['965', 'KW'], ['966', 'SA'], ['971', 'AE'], ['972', 'IL'], ['974', 'QA'],
];

export function countryFromPhone(e164: string | undefined): string | undefined {
  if (!e164 || !e164.startsWith('+')) return undefined;
  const digits = e164.slice(1);
  for (const len of [3, 2, 1]) {
    const hit = DIAL_CODES.find(([d]) => d.length === len && digits.startsWith(d));
    if (hit) return hit[1];
  }
  return undefined;
}

export function countryToIso(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const n = normalizeHeader(raw);
  if (!n) return undefined;
  if (/^[a-z]{2}$/.test(n) && Object.values(COUNTRY_NAMES).includes(n.toUpperCase())) return n.toUpperCase();
  return COUNTRY_NAMES[n];
}

// ── Valeurs ──────────────────────────────────────────────────────────────────
function parseBool(v: string): boolean | undefined {
  const n = normalizeHeader(v);
  if (!n) return undefined;
  if (['oui', 'yes', 'si', 'true', '1', 'y', 'o', 'x', 'subscribed', 'abonne', 'suscrito', 'opt in', 'optin', 'ok', 'accepte'].includes(n)) return true;
  if (['non', 'no', 'false', '0', 'n', 'unsubscribed', 'desabonne', 'no suscrito', 'opt out', 'optout', 'refuse'].includes(n)) return false;
  return undefined;
}

function parseGender(v: string): Gender | undefined {
  const n = normalizeHeader(v);
  if (!n) return undefined;
  if (['f', 'female', 'femme', 'woman', 'women', 'mujer', 'mme', 'madame', 'mlle', 'w', 'feminin', 'femenino'].includes(n)) return 'female';
  if (['m', 'male', 'homme', 'man', 'men', 'hombre', 'mr', 'monsieur', 'h', 'masculin', 'masculino'].includes(n)) return 'male';
  if (['other', 'autre', 'otro', 'non binaire', 'non-binary', 'nb', 'x', 'divers'].includes(n)) return 'other';
  return undefined;
}

/** « 18,35 € », « €18.35 », « 1 250,00 » → 18.35 / 18.35 / 1250. */
export function parseMoney(v: string): number | undefined {
  let s = (v || '').trim().replace(/[€$£\s\u00A0\u202F]/g, '').replace(/[a-zA-Z]+$/g, '');
  if (!s) return undefined;
  // Les deux séparateurs présents : le dernier est la décimale.
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

function parseInt10(v: string): number | undefined {
  const s = (v || '').replace(/[^0-9-]/g, '');
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** ISO (2026-02-17T23:42:02.093Z), 17/02/2026, 2026-02-17, 17-02-2026, 02/17/2026 (ordre FR d'abord). */
export function parseDate(v: string): string | undefined {
  const s = (v || '').trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, a, b] = m;
    let y = m[3];
    if (y.length === 2) y = `20${y}`;
    let day = parseInt(a, 10); let month = parseInt(b, 10);
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    const d = new Date(Date.UTC(parseInt(y, 10), month - 1, day, m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function ageFromBirth(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const b = new Date(iso); const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age >= 12 && age <= 110 ? age : undefined;
}

// ── Le parseur ───────────────────────────────────────────────────────────────
export function parseContactFile(raw: string, country: CountryOption = IMPORT_COUNTRIES[0]): ContactParseResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const result: ContactParseResult = {
    rows: [], invalid: [], duplicates: 0, totalRows: 0, detected: {},
    stats: { emails: 0, phones: 0, both: 0, withLocation: 0, withSpend: 0, withEvents: 0, withLastPurchase: 0, withAge: 0, withGender: 0 },
  };
  if (lines.length === 0) return result;

  const delimiter = detectDelimiter(lines[0]);
  const firstRaw = splitCsvLine(lines[0], delimiter);
  const firstCells = firstRaw.map(normalizeHeader);
  const firstLineHasIdentity = firstRaw.some((c) => isValidEmail(c) || extractAngleBracket(c) !== null || (looksLikePhone(c) && normalizePhone(c, country) !== null));
  const headerMatch = firstCells.some((c) => (Object.keys(H_NORM) as ContactField[]).some((f) => H_NORM[f].has(c)));
  const hasHeader = !firstLineHasIdentity && headerMatch;

  const idx: Partial<Record<ContactField, number>> = {};
  if (hasHeader) {
    const taken = new Set<number>();
    for (const f of FIELD_ORDER) {
      const i = firstCells.findIndex((c, j) => !taken.has(j) && H_NORM[f].has(c));
      if (i >= 0) { idx[f] = i; taken.add(i); }
    }
    // « Nom » sans « Prénom » à côté : c'est un nom complet.
    if (idx.lastName != null && idx.firstName == null && idx.fullName == null) { idx.fullName = idx.lastName; delete idx.lastName; }
    for (const f of Object.keys(idx) as ContactField[]) result.detected[f] = firstRaw[idx[f] as number];
  }

  const seen = new Set<string>();
  const rows = hasHeader ? lines.slice(1) : lines;
  const cell = (cells: string[], f: ContactField): string => (idx[f] == null ? '' : (cells[idx[f] as number] ?? '').trim());

  for (const line of rows) {
    result.totalRows++;
    const cells = splitCsvLine(line, delimiter);

    // 1. Email : colonne déclarée, sinon la première cellule qui y ressemble.
    let email = ''; let inlineName: string | undefined;
    const tryEmail = (c: string): boolean => {
      if (!c) return false;
      const angle = extractAngleBracket(c);
      if (angle && isValidEmail(angle.email)) { email = angle.email; inlineName = angle.name; return true; }
      if (isValidEmail(c)) { email = c; return true; }
      return false;
    };
    if (idx.email != null) tryEmail(cell(cells, 'email'));
    if (!email) for (const c of cells) if (tryEmail(c)) break;
    if (!email && !hasHeader) {
      const loose = line.split(/[\s,;]+/).find((tok) => isValidEmail(tok));
      if (loose) email = loose;
    }

    // 2. Téléphone : colonne déclarée, sinon une cellule qui ressemble à un numéro.
    let phone: string | null = null;
    if (idx.phone != null) phone = normalizePhone(cell(cells, 'phone'), country);
    if (!phone && (idx.phone == null || !hasHeader)) {
      for (let i = 0; i < cells.length; i++) {
        if (i === idx.email || i === idx.postalCode || i === idx.age || i === idx.totalSpent || i === idx.eventCount) continue;
        const c = cells[i];
        if (looksLikePhone(c)) { const p = normalizePhone(c, country); if (p) { phone = p; break; } }
      }
    }

    if (!email && !phone) {
      if (result.invalid.length < 50) result.invalid.push(line.slice(0, 120));
      continue;
    }

    const emailNorm = email ? email.trim().toLowerCase() : undefined;
    const key = emailNorm || (phone as string);
    if (seen.has(key)) { result.duplicates++; continue; }
    seen.add(key);

    // 3. Noms.
    let first: string | undefined; let last: string | undefined;
    if (idx.firstName != null) first = cell(cells, 'firstName') || undefined;
    if (idx.lastName != null) last = cell(cells, 'lastName') || undefined;
    if (!first && !last && idx.fullName != null && cell(cells, 'fullName')) { const s = splitFullName(cell(cells, 'fullName')); first = s.first; last = s.last; }
    if (!first && !last && inlineName) { const s = splitFullName(inlineName); first = s.first; last = s.last; }
    if (!first && !last && !hasHeader) {
      const nameCell = cells.find((c) => c && !looksLikePhone(c) && !isValidEmail(c) && /[a-zA-ZÀ-ÿ]/.test(c) && c.length < 60);
      if (nameCell) { const s = splitFullName(nameCell); first = s.first; last = s.last; }
    }

    const row: ContactRow = {};
    if (emailNorm) row.email = emailNorm;
    if (phone) row.phone = phone;
    if (first) row.first_name = first.slice(0, 80);
    if (last) row.last_name = last.slice(0, 80);

    // 4. Attributs.
    const countryRaw = cell(cells, 'country');
    if (countryRaw) row.country = countryRaw.slice(0, 80);
    row.country_code = countryToIso(countryRaw) || countryFromPhone(phone || undefined);
    if (!row.country_code) delete row.country_code;
    const region = cell(cells, 'region'); if (region) row.region = region.slice(0, 80);
    const city = cell(cells, 'city'); if (city) row.city = city.slice(0, 80);
    const pc = cell(cells, 'postalCode'); if (pc) row.postal_code = pc.slice(0, 20);
    const zone = cell(cells, 'zone'); if (zone) row.zone = zone.slice(0, 80);
    const age = parseInt10(cell(cells, 'age'));
    if (age != null && age >= 12 && age <= 110) row.age = age;
    else { const a = ageFromBirth(parseDate(cell(cells, 'birthDate'))); if (a != null) row.age = a; }
    const g = parseGender(cell(cells, 'gender')); if (g) row.gender = g;
    const nl = parseBool(cell(cells, 'newsletter')); if (nl != null) row.newsletter_opt_in = nl;
    const added = parseDate(cell(cells, 'addedAt')); if (added) row.added_at = added;
    const lastP = parseDate(cell(cells, 'lastPurchaseAt')); if (lastP) row.last_purchase_at = lastP;
    const spent = parseMoney(cell(cells, 'totalSpent')); if (spent != null && spent >= 0) row.total_spent = spent;
    const ev = parseInt10(cell(cells, 'eventCount')); if (ev != null && ev >= 0) row.event_count = ev;

    result.rows.push(row);
    if (row.email) result.stats.emails++;
    if (row.phone) result.stats.phones++;
    if (row.email && row.phone) result.stats.both++;
    if (row.city || row.zone || row.country_code) result.stats.withLocation++;
    if (row.total_spent != null) result.stats.withSpend++;
    if (row.event_count != null) result.stats.withEvents++;
    if (row.last_purchase_at) result.stats.withLastPurchase++;
    if (row.age != null) result.stats.withAge++;
    if (row.gender) result.stats.withGender++;
  }
  return result;
}

/** Lots pour la RPC (plafond serveur : 2 000 lignes par appel). */
export function chunkRows<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
