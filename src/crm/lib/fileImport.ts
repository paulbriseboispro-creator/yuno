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

export type ColField = 'email' | 'tel' | 'prenom' | 'nom' | 'ville' | 'skip';
export const COL_FIELDS: ColField[] = ['email', 'tel', 'prenom', 'nom', 'ville', 'skip'];
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
    if (/prenom|first|given/.test(s)) k = 'prenom';
    else if (/^nom|last|surname|famil|apellido/.test(s)) k = 'nom';
    else if (/mail|courriel|correo/.test(s)) k = 'email';
    else if (/tel|mobile|portable|phone|gsm|movil|whatsapp/.test(s)) k = 'tel';
    else if (/ville|city|ciudad|localite/.test(s)) k = 'ville';
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
  const get = (r: string[], j: number) => (j >= 0 ? String(r[j] ?? '').trim() : '');
  const lines: FileLine[] = [];
  const dup: Analysis['dup'] = [];
  const bad: Analysis['bad'] = [];
  const seen = new Map<string, number>();
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
    lines.push({ line, name, email: eOk ? e : null, phone: t, first_name: first, last_name: last, city: get(r, iV) || null });
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
  return row;
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
