/**
 * Lecture d'un fichier de contacts pour l'assistant d'import de la Console
 * CRM : CSV (séparateur deviné, guillemets, UTF-8 sinon Windows-1252) ou
 * Excel (.xlsx, première feuille), colonnes devinées, puis répartition de
 * chaque ligne en quatre groupes — nouveau, déjà dans la base, en double
 * dans le fichier, à corriger. Aucune I/O réseau ici : la comparaison à la
 * base vient de crm_import_check, passée en argument.
 */
import { isValidEmail } from '@/lib/emailImport';
import { IMPORT_COUNTRIES, normalizePhone } from '@/lib/smsImport';
import { ageFromBirth, countryToIso, parseDate, parseGender, parseMoney } from '@/lib/contactImport';
import type { Gender } from '@/lib/contactImport';

/**
 * Champs d'une colonne. Âge, date de naissance, genre, pays et code postal
 * nourrissent les segments du catalogue (âge, genre, villes, pays). Total
 * dépensé, nombre de soirées, dernier achat et première venue sont
 * l'historique du client : ils comptent dans son cycle de vie
 * (_crm_people_build, sans jamais doubler ce que Shotgun rapporte).
 */
export type ColField = 'email' | 'tel' | 'prenom' | 'nom' | 'ville' | 'cp' | 'pays' | 'age' | 'naissance' | 'genre'
  | 'depense' | 'soirees' | 'dernier' | 'premier' | 'skip';
export const COL_FIELDS: ColField[] = ['email', 'tel', 'prenom', 'nom', 'ville', 'cp', 'pays', 'age', 'naissance', 'genre', 'depense', 'soirees', 'dernier', 'premier', 'skip'];
export const MAX_LINES = 50_000;
export const MAX_BYTES = 25 * 1024 * 1024;

export interface ParsedFile { head: string[]; rows: string[][] }

/** CSV → en-têtes + lignes (lignes vides retirées). */
export function parseCsv(input: string): ParsedFile {
  const text = input.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] ?? '';
  const cnt = (c: string) => first.split(c).length - 1;
  const d = cnt(';') >= cnt(',') && cnt(';') >= cnt('\t') ? ';' : cnt('\t') > cnt(',') ? '\t' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; out.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  const rows = out.filter((r) => r.some((c) => c.trim() !== ''));
  return { head: (rows[0] ?? []).map((h) => h.trim()), rows: rows.slice(1) };
}

/** Texte d'un CSV : UTF-8, sinon Windows-1252 (exports Excel français). */
export function decodeText(buf: ArrayBuffer): string {
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('\uFFFD')) return utf;
  try { return new TextDecoder('windows-1252').decode(buf); } catch { return utf; }
}

const colIndex = (ref: string) => {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Première feuille d'un .xlsx → lignes de texte. Lève si le fichier n'est pas lisible. */
export async function parseXlsx(buf: ArrayBuffer): Promise<ParsedFile> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buf));
  const xml = (p: string) => (files[p] ? new DOMParser().parseFromString(strFromU8(files[p]), 'application/xml') : null);
  const shared: string[] = [];
  const ss = xml('xl/sharedStrings.xml');
  if (ss) ss.querySelectorAll('si').forEach((si) => shared.push(Array.from(si.querySelectorAll('t')).map((t) => t.textContent ?? '').join('')));
  // Première feuille du classeur (ordre du workbook), sinon sheet1.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  const first = wb?.querySelector('sheet');
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (rid && rels) {
    const target = Array.from(rels.querySelectorAll('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = xml(sheetPath);
  if (!sheet) throw new Error('xlsx_no_sheet');
  const out: string[][] = [];
  sheet.querySelectorAll('sheetData > row').forEach((r) => {
    const row: string[] = [];
    r.querySelectorAll('c').forEach((c) => {
      const ref = c.getAttribute('r');
      const i = ref ? colIndex(ref) : row.length;
      const tp = c.getAttribute('t');
      let v = '';
      if (tp === 's') v = shared[Number(c.querySelector('v')?.textContent ?? -1)] ?? '';
      else if (tp === 'inlineStr') v = Array.from(c.querySelectorAll('is t')).map((t) => t.textContent ?? '').join('');
      else v = c.querySelector('v')?.textContent ?? '';
      while (row.length < i) row.push('');
      row[i] = v;
    });
    out.push(row);
  });
  const rows = out.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
  return { head: (rows[0] ?? []).map((h) => (h ?? '').trim()), rows: rows.slice(1) };
}

/** Lit un fichier choisi : .xlsx par son contenu (signature ZIP), le reste en texte. */
export async function readContactFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const sig = new Uint8Array(buf.slice(0, 4));
  const isZip = sig[0] === 0x50 && sig[1] === 0x4b;
  if (isZip) return parseXlsx(buf);
  if (/\.xls$/i.test(file.name)) throw new Error('xls_legacy');
  return parseCsv(decodeText(buf));
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Devine le champ de chaque colonne (un champ ne sert qu'une fois). */
export function autoMap(head: string[], rows: string[][] = []): ColField[] {
  const used = new Set<ColField>();
  const map = head.map((h): ColField => {
    const s = norm(h);
    let k: ColField = 'skip';
    // Les dates d'historique d'abord : « Last purchase » n'est pas un nom, « First order » pas un prénom.
    if (/^dernier|^derniere|last[ _-]?(purchase|order|event|visit|seen|activity|ticket)|ultim/.test(s)) k = 'dernier';
    else if (/premier achat|premiere (venue|visite|commande)|first[ _-]?(purchase|order|visit|event)|^ajoute|^added|^created|creation|inscri|sign[ _-]?up|^alta|primera/.test(s)) k = 'premier';
    // « Nombre » est un PRÉNOM en espagnol : avant /^nom/, qui le prenait pour un nom.
    else if (/prenom|first|given|^nombre$/.test(s)) k = 'prenom';
    else if (/^nom|last|surname|famil|apellido/.test(s)) k = 'nom';
    else if (/mail|courriel|correo/.test(s)) k = 'email';
    else if (/depens|spent|spend|montant|gasto|importe|amount|ltv|chiffre d.?affaires|^ca$|revenue/.test(s)) k = 'depense';
    else if (/evenement|\bevents?\b|event[ _-]?count|soirees?|visites?|eventos|visitas|attendance|commandes|orders|billets|tickets|entradas/.test(s)) k = 'soirees';
    else if (/tel|mobile|portable|phone|gsm|movil|whatsapp/.test(s)) k = 'tel';
    else if (/code postal|codigo postal|^cp$|zip|postal|postcode/.test(s)) k = 'cp';
    else if (/ville|city|ciudad|localite|commune|municipio/.test(s)) k = 'ville';
    else if (/^pays|country|^pais|nationalit/.test(s)) k = 'pays';
    else if (/naissance|birth|^dob$|nacimiento|anniversaire/.test(s)) k = 'naissance';
    else if (/^age$|^edad$/.test(s)) k = 'age';
    else if (/genre|sexe|gender|^sex|genero|sexo|civilit/.test(s)) k = 'genre';
    if (k !== 'skip') { if (used.has(k)) k = 'skip'; else used.add(k); }
    return k;
  });
  // Sans en-tête reconnu, une colonne pleine d'adresses reste un e-mail.
  if (!used.has('email')) {
    const i = head.findIndex((_, j) => map[j] === 'skip' && rows.slice(0, 20).filter((r) => isValidEmail(normEmail(r[j] ?? ''))).length >= Math.min(3, rows.length));
    if (i >= 0) map[i] = 'email';
  }
  return map;
}

export const normEmail = (v: string) => (v ?? '').trim().toLowerCase().replace(/^mailto:/, '');
export const normTel = (v: string) => normalizePhone(v ?? '', IMPORT_COUNTRIES[0]);

export interface FileLine {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  postal_code?: string | null;
  /** ISO 2 quand le pays est reconnu ; sinon le texte, gardé tel quel. */
  country_code?: string | null;
  country?: string | null;
  age?: number | null;
  gender?: Gender | null;
  /** Historique du fichier : total dépensé (€), soirées, dates ISO. */
  total_spent?: number | null;
  event_count?: number | null;
  last_purchase_at?: string | null;
  added_at?: string | null;
}

export interface BucketItem { t: string; s: string }
export interface Analysis {
  fresh: FileLine[];
  exist: (FileLine & { by: 'email' | 'tel'; who: string })[];
  dup: { line: number; name: string; other: number; by: 'email' | 'tel' }[];
  bad: { line: number; name: string; why: 'email' | 'tel' | 'none'; value: string }[];
  emails: string[];
  phones: string[];
}

/** Lignes du fichier → identités, doublons internes et lignes inutilisables (avant comparaison à la base). */
export function prepareLines(file: ParsedFile, map: ColField[]) {
  const iE = map.indexOf('email');
  const iT = map.indexOf('tel');
  const iP = map.indexOf('prenom');
  const iN = map.indexOf('nom');
  const iV = map.indexOf('ville');
  const iC = map.indexOf('cp');
  const iY = map.indexOf('pays');
  const iA = map.indexOf('age');
  const iB = map.indexOf('naissance');
  const iG = map.indexOf('genre');
  const iD = map.indexOf('depense');
  const iS = map.indexOf('soirees');
  const iL = map.indexOf('dernier');
  const iF = map.indexOf('premier');
  const get = (r: string[], j: number) => (j >= 0 ? String(r[j] ?? '').trim() : '');
  const lines: FileLine[] = [];
  const dup: Analysis['dup'] = [];
  const bad: Analysis['bad'] = [];
  const seen = new Map<string, number>();
  const profileOf = (r: string[]): Partial<FileLine> => {
    const out: Partial<FileLine> = {};
    const cp = get(r, iC);
    if (cp) out.postal_code = cp.slice(0, 20);
    const py = get(r, iY);
    if (py) { const iso = countryToIso(py); if (iso) out.country_code = iso; else out.country = py.slice(0, 80); }
    out.age = readAge(get(r, iA), get(r, iB));
    const g = get(r, iG);
    if (g) out.gender = parseGender(g) ?? null;
    const sp = parseMoney(get(r, iD));
    if (sp !== undefined && sp >= 0) out.total_spent = sp;
    const ev = readCount(get(r, iS));
    if (ev !== null) out.event_count = ev;
    const ld = parseDate(get(r, iL));
    if (ld) out.last_purchase_at = ld;
    const fd = parseDate(get(r, iF));
    if (fd) out.added_at = fd;
    return out;
  };
  file.rows.forEach((r, i) => {
    const line = i + 2;
    const rawE = get(r, iE);
    const rawT = get(r, iT);
    const e = normEmail(rawE);
    const eOk = !!e && isValidEmail(e);
    const t = rawT ? normTel(rawT) : null;
    const first = get(r, iP) || null;
    const last = get(r, iN) || null;
    const name = [first, last].filter(Boolean).join(' ') || (eOk ? e.split('@')[0] : t ?? rawT) || '';
    if (!eOk && !t) {
      bad.push({ line, name, why: rawE ? 'email' : rawT ? 'tel' : 'none', value: rawE || rawT });
      return;
    }
    const keys: string[] = [];
    if (eOk) keys.push(`e:${e}`);
    if (t) keys.push(`t:${t}`);
    const hit = keys.find((k) => seen.has(k));
    if (hit) {
      dup.push({ line, name, other: seen.get(hit) as number, by: hit.startsWith('e') ? 'email' : 'tel' });
      keys.forEach((k) => { if (!seen.has(k)) seen.set(k, seen.get(hit) as number); });
      return;
    }
    keys.forEach((k) => seen.set(k, line));
    lines.push({ line, name, email: eOk ? e : null, phone: t, first_name: first, last_name: last, city: get(r, iV) || null, ...profileOf(r) });
  });
  return {
    lines, dup, bad,
    emails: Array.from(new Set(lines.map((l) => l.email).filter((x): x is string => !!x))),
    phones: Array.from(new Set(lines.map((l) => l.phone).filter((x): x is string => !!x))),
  };
}

export interface BaseMatch { first_name: string | null; last_name: string | null; email?: string | null; nights: number; since: string | null }

/** Répartition finale avec les correspondances trouvées dans la base. */
export function splitWithBase(
  prep: ReturnType<typeof prepareLines>,
  byEmail: Map<string, BaseMatch>,
  byPhone: Map<string, BaseMatch>,
): Analysis {
  const fresh: Analysis['fresh'] = [];
  const exist: Analysis['exist'] = [];
  for (const l of prep.lines) {
    const mE = l.email ? byEmail.get(l.email) : undefined;
    const mT = !mE && l.phone ? byPhone.get(l.phone) : undefined;
    const m = mE ?? mT;
    if (m) {
      const who = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || l.email || l.phone || '';
      exist.push({ ...l, by: mE ? 'email' : 'tel', who });
    } else fresh.push(l);
  }
  return { fresh, exist, dup: prep.dup, bad: prep.bad, emails: prep.emails, phones: prep.phones };
}

/** Une ligne pour import_contact_list. */
export function toImportRow(l: FileLine) {
  const row: Record<string, string> = {};
  if (l.email) row.email = l.email;
  if (l.phone) row.phone = l.phone;
  if (l.first_name) row.first_name = l.first_name;
  if (l.last_name) row.last_name = l.last_name;
  if (l.city) row.city = l.city;
  if (l.postal_code) row.postal_code = l.postal_code;
  if (l.country_code) row.country_code = l.country_code;
  else if (l.country) row.country = l.country;
  if (l.age) row.age = String(l.age);
  if (l.gender) row.gender = l.gender;
  if (l.total_spent !== undefined && l.total_spent !== null) row.total_spent = String(l.total_spent);
  if (l.event_count !== undefined && l.event_count !== null) row.event_count = String(l.event_count);
  if (l.last_purchase_at) row.last_purchase_at = l.last_purchase_at;
  if (l.added_at) row.added_at = l.added_at;
  return row;
}

/** « 12 », « 12 soirées », « 1 204 » → entier ; vide ou illisible → null. */
export function readCount(v: string): number | null {
  const s = (v ?? '').replace(/[\s\u00A0\u202F]/g, '');
  if (!/^\d{1,6}/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Âge d'une ligne : la colonne « Âge » (12 à 110 ans), sinon la date de
 * naissance. Un âge hors bornes n'est pas gardé (le serveur le refuse aussi).
 */
export function readAge(age: string, birth: string): number | null {
  const a = /^\d{1,3}$/.test(age.trim()) ? Number(age.trim()) : NaN;
  if (a >= 12 && a <= 110) return a;
  return ageFromBirth(parseDate(birth)) ?? null;
}

/** Le fichier d'exemple (adresses @exemple.fr, numéros de fiction). */
export const SAMPLE_CSV = [
  'Prénom;Nom;Email;Mobile;Ville',
  'Chloé;Bernard;chloe.bernard@exemple.fr;06 39 98 10 01;Paris',
  'Mehdi;Haddad;mehdi.haddad@exemple.fr;07 77 42 10 02;Montreuil',
  'Inès;Moreau;ines.moreau@exemple.fr;;Paris',
  'Tom;Leroy;tom.leroy@exemple.fr;+33 6 39 98 10 04;Lyon',
  'Chloé;Bernard;CHLOE.BERNARD@exemple.fr;;Paris',
  'Sarah;Khan;sarah.k@exemple;;Paris',
  'Noah;Petit;noah.petit@exemple.fr;06 39 98 10 07;Paris',
  'Jade;Lambert;jade.lambert@exemple.fr;;Boulogne',
  'Yanis;Cherif;;07 77 42 10 09;Paris',
  'Yanis;Cherif;;0777421009;Paris',
  'Manon;Girard;manon.girard@exemple.fr;06 39 98 10 11;Paris',
  'Lucas;Fabre;lucas.fabre@exemple.fr;;Vincennes',
  'Anaïs;Dubois;anais.dubois@exemple.fr;06 39 98 10 13;Paris',
  'Inconnu;;;;Paris',
  'Zoé;Lopez;zoe.lopez@exemple.fr;07 77 42 10 15;Nogent',
  'Elsa;Fontaine;elsa.fontaine@exemple.fr;06 39 98 10 16;Paris',
].join('\n');

export const TEMPLATE_CSV = 'Prénom;Nom;Email;Mobile;Ville\nLéa;Martin;lea@exemple.fr;06 12 34 56 78;Paris\n';
