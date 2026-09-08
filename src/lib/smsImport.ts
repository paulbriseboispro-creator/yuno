// Lecture d'une liste de numéros apportée par un pro (import SMS).
//
// Même philosophie que emailImport.ts : on accepte le fichier tel qu'il vient
// (CSV, TSV, export d'un autre outil, simple colonne de numéros) et on rend un
// rapport immédiat. La RPC `import_sms_contacts` refait la validation E.164
// côté serveur : ici c'est du confort, pas de la sécurité.
//
// La particularité du téléphone : un fichier français contient « 06 12 34 56 78 »,
// pas « +33612345678 ». Le pays par défaut choisi dans le dialogue sert à
// compléter les numéros nationaux ; un numéro déjà international (+…, 00…)
// est pris tel quel.

import { splitCsvLine } from '@/lib/emailImport';

export interface ParsedPhoneContact {
  phone: string;
  first_name?: string;
  last_name?: string;
}

export interface PhoneParseResult {
  contacts: ParsedPhoneContact[];
  invalid: string[];
  duplicates: number;
  totalRows: number;
  detected: { phone?: string; firstName?: string; lastName?: string; fullName?: string };
}

export interface CountryOption { code: string; dial: string; label: string; trunk: string }

/** Pays proposés pour compléter les numéros nationaux. `trunk` = préfixe national à retirer. */
export const IMPORT_COUNTRIES: CountryOption[] = [
  { code: 'FR', dial: '33', label: 'France (+33)', trunk: '0' },
  { code: 'ES', dial: '34', label: 'España (+34)', trunk: '' },
  { code: 'BE', dial: '32', label: 'Belgique (+32)', trunk: '0' },
  { code: 'CH', dial: '41', label: 'Suisse (+41)', trunk: '0' },
  { code: 'IT', dial: '39', label: 'Italia (+39)', trunk: '' },
  { code: 'DE', dial: '49', label: 'Deutschland (+49)', trunk: '0' },
  { code: 'PT', dial: '351', label: 'Portugal (+351)', trunk: '' },
  { code: 'NL', dial: '31', label: 'Nederland (+31)', trunk: '0' },
  { code: 'GB', dial: '44', label: 'United Kingdom (+44)', trunk: '0' },
  { code: 'MA', dial: '212', label: 'Maroc (+212)', trunk: '0' },
  { code: 'LU', dial: '352', label: 'Luxembourg (+352)', trunk: '' },
  { code: 'US', dial: '1', label: 'USA / Canada (+1)', trunk: '1' },
];

const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Ramène un numéro à de l'E.164, ou null.
 *  - « +33 6 12 34 56 78 », « 0033612345678 » → +33612345678
 *  - « 06 12 34 56 78 » avec pays FR → +33612345678
 *  - « 612 345 678 » avec pays ES → +34612345678
 */
export function normalizePhone(raw: string, country: CountryOption): string | null {
  let s = (raw || '').trim();
  if (!s) return null;
  // Préfixe ~ / ' des tableurs, parenthèses, points, tirets, espaces insécables.
  s = s.replace(/^[~'"\s]+|["'\s]+$/g, '').replace(/[\s.\-() ]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/[^0-9]/g, '');
    const e = `+${digits}`;
    return E164.test(e) ? e : null;
  }
  if (!/^[0-9]+$/.test(s)) return null;
  // Déjà préfixé par l'indicatif sans « + » (« 33612345678 ») : fréquent dans
  // les exports Excel qui ont mangé le signe plus.
  if (s.startsWith(country.dial) && s.length >= country.dial.length + 8) {
    const e = `+${s}`;
    if (E164.test(e)) return e;
  }
  let national = s;
  if (country.trunk && national.startsWith(country.trunk)) national = national.slice(country.trunk.length);
  if (national.length < 6) return null;
  const e = `+${country.dial}${national}`;
  return E164.test(e) ? e : null;
}

const PHONE_HEADERS = ['telephone', 'téléphone', 'tel', 'tél', 'phone', 'phone number', 'mobile', 'portable', 'gsm', 'numero', 'numéro', 'num', 'cellphone', 'cell', 'movil', 'móvil', 'telefono', 'teléfono', 'sms', 'whatsapp'];
const FIRST_HEADERS = ['prenom', 'prénom', 'first name', 'firstname', 'first_name', 'given name', 'nombre'];
const LAST_HEADERS  = ['nom', 'nom de famille', 'last name', 'lastname', 'last_name', 'surname', 'family name', 'apellido', 'apellidos'];
const FULL_HEADERS  = ['nom complet', 'full name', 'fullname', 'name', 'nombre completo', 'contact'];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^﻿/, '').replace(/["']/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

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

/** Une cellule « ressemble » à un numéro si, nettoyée, elle a 6 à 15 chiffres. */
function looksLikePhone(cell: string): boolean {
  const digits = cell.replace(/[^0-9]/g, '');
  return digits.length >= 6 && digits.length <= 15 && /^[\s+0-9().\-~'"]+$/.test(cell.trim());
}

export function parsePhoneList(raw: string, country: CountryOption): PhoneParseResult {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const result: PhoneParseResult = { contacts: [], invalid: [], duplicates: 0, totalRows: 0, detected: {} };
  if (lines.length === 0) return result;

  const delimiter = detectDelimiter(lines[0]);
  const firstRaw = splitCsvLine(lines[0], delimiter);
  const firstCells = firstRaw.map(normalizeHeader);
  const firstLineHasPhone = firstRaw.some((c) => looksLikePhone(c) && normalizePhone(c, country) !== null);
  const headerMatch = firstCells.some((c) =>
    PHONE_HEADERS.includes(c) || FIRST_HEADERS.includes(c) || LAST_HEADERS.includes(c) || FULL_HEADERS.includes(c));
  const hasHeader = !firstLineHasPhone && headerMatch;

  let phoneIdx = -1, firstIdx = -1, lastIdx = -1, fullIdx = -1;
  if (hasHeader) {
    firstCells.forEach((c, i) => {
      if (phoneIdx < 0 && PHONE_HEADERS.includes(c)) phoneIdx = i;
      if (firstIdx < 0 && FIRST_HEADERS.includes(c)) firstIdx = i;
      if (lastIdx < 0 && LAST_HEADERS.includes(c)) lastIdx = i;
      if (fullIdx < 0 && FULL_HEADERS.includes(c)) fullIdx = i;
    });
    if (lastIdx >= 0 && firstIdx < 0) { fullIdx = lastIdx; lastIdx = -1; }
    result.detected = {
      phone: phoneIdx >= 0 ? firstRaw[phoneIdx] : undefined,
      firstName: firstIdx >= 0 ? firstRaw[firstIdx] : undefined,
      lastName: lastIdx >= 0 ? firstRaw[lastIdx] : undefined,
      fullName: fullIdx >= 0 ? firstRaw[fullIdx] : undefined,
    };
  }

  const seen = new Set<string>();
  const rows = hasHeader ? lines.slice(1) : lines;
  for (const line of rows) {
    result.totalRows++;
    const cells = splitCsvLine(line, delimiter);
    let phone: string | null = null;
    if (phoneIdx >= 0) phone = normalizePhone(cells[phoneIdx] ?? '', country);
    if (!phone) {
      // Colonne non déclarée ou mal alignée : première cellule qui ressemble à un numéro.
      for (const cell of cells) {
        if (looksLikePhone(cell)) { const p = normalizePhone(cell, country); if (p) { phone = p; break; } }
      }
    }
    if (!phone) {
      if (result.invalid.length < 50) result.invalid.push(line.slice(0, 120));
      continue;
    }
    if (seen.has(phone)) { result.duplicates++; continue; }
    seen.add(phone);

    let first: string | undefined; let last: string | undefined;
    if (firstIdx >= 0) first = cells[firstIdx] || undefined;
    if (lastIdx >= 0) last = cells[lastIdx] || undefined;
    if (!first && !last && fullIdx >= 0 && cells[fullIdx]) { const s = splitFullName(cells[fullIdx]); first = s.first; last = s.last; }
    // Fichier sans en-tête « Léa Martin;0612345678 » : la cellule texte est le nom.
    if (!first && !last && !hasHeader) {
      const nameCell = cells.find((c) => c && !looksLikePhone(c) && /[a-zA-ZÀ-ÿ]/.test(c));
      if (nameCell) { const s = splitFullName(nameCell); first = s.first; last = s.last; }
    }
    const contact: ParsedPhoneContact = { phone };
    if (first) contact.first_name = first.slice(0, 80);
    if (last) contact.last_name = last.slice(0, 80);
    result.contacts.push(contact);
  }
  return result;
}
