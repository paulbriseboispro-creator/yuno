// Lecture d'une base email apportée par un pro.
//
// Le fichier qu'on reçoit n'est jamais propre. C'est un export Mailchimp, un
// Google Sheets recopié, un copier-coller d'Outlook, parfois juste une colonne
// d'adresses. On accepte tout ça sans demander au pro de « formater son CSV » —
// à ce stade de la relation, chaque friction est une soirée qu'il ne remplit pas.
//
// Ce module ne parle qu'à des chaînes : aucune I/O, aucun appel réseau. Toute
// la validation se fait ici, AVANT d'envoyer quoi que ce soit au serveur, pour
// que le pro voie son rapport (valides / doublons / invalides) instantanément.
// La RPC `import_email_contacts` refait exactement les mêmes contrôles côté
// serveur : le front est là pour le confort, jamais pour la sécurité.

export interface ParsedContact {
  email: string;
  first_name?: string;
  last_name?: string;
}

export interface ParseResult {
  contacts: ParsedContact[];
  /** Lignes qui contenaient quelque chose mais aucune adresse exploitable. */
  invalid: string[];
  /** Adresses vues plusieurs fois dans le fichier (comptées une seule fois). */
  duplicates: number;
  /** Lignes non vides lues. */
  totalRows: number;
  /** En-têtes reconnus, pour l'affichage « colonne email détectée : … ». */
  detected: { email?: string; firstName?: string; lastName?: string; fullName?: string };
}

// Volontairement proche du regex serveur. Ni plus permissif (on enverrait des
// adresses mortes qui feraient bouncer), ni plus strict (les TLD exotiques et
// les `+tag` sont légitimes).
const EMAIL_RE = /^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length <= 254 && EMAIL_RE.test(v);
}

const EMAIL_HEADERS = ['email', 'e-mail', 'mail', 'courriel', 'adresse email', 'email address', 'correo', 'correo electronico', 'correo electrónico'];
const FIRST_HEADERS = ['prenom', 'prénom', 'first name', 'firstname', 'first_name', 'given name', 'nombre'];
const LAST_HEADERS  = ['nom', 'nom de famille', 'last name', 'lastname', 'last_name', 'surname', 'family name', 'apellido', 'apellidos'];
// « nom » seul est ambigu en français : chez beaucoup de clubs la colonne « Nom »
// contient le nom COMPLET. On la traite comme un nom complet quand il n'y a pas
// de colonne prénom à côté.
const FULL_HEADERS  = ['nom complet', 'full name', 'fullname', 'name', 'nombre completo', 'contact'];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/["']/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Détecte le séparateur sur la première ligne non vide : `,` `;` tab ou `|`. */
function detectDelimiter(line: string): string {
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    // On ignore ce qui est entre guillemets pour ne pas compter les virgules
    // d'un « Dupont, Jean » collé dans une seule cellule.
    const count = splitCsvLine(line, d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/** Découpe une ligne CSV en respectant les guillemets et les `""` échappés. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** « Léa Martin <lea@club.fr> » → adresse + nom. Format Outlook / Gmail. */
function extractAngleBracket(cell: string): { email: string; name?: string } | null {
  const m = cell.match(/^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (!m) return null;
  return { email: m[2], name: m[1]?.replace(/^["']|["']$/g, '').trim() || undefined };
}

function splitFullName(full: string): { first?: string; last?: string } {
  const clean = full.replace(/\s+/g, ' ').trim();
  if (!clean) return {};
  // « Martin, Léa » — convention Nom, Prénom des exports Outlook et des
  // annuaires. Sans ce cas, le prénom stocké serait « Martin, » et tous les
  // « Salut {{prenom}} » de la campagne partiraient à l'envers.
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

/**
 * Parse un CSV, un TSV, ou une simple liste d'adresses.
 * Tolère : BOM, en-têtes absents, colonnes dans n'importe quel ordre,
 * « Nom <email> », plusieurs adresses séparées par des virgules sur une ligne.
 */
export function parseContactList(raw: string): ParseResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const result: ParseResult = {
    contacts: [], invalid: [], duplicates: 0, totalRows: 0, detected: {},
  };
  if (lines.length === 0) return result;

  const delimiter = detectDelimiter(lines[0]);
  const firstCells = splitCsvLine(lines[0], delimiter).map(normalizeHeader);

  // En-tête ? Oui si aucune cellule de la 1re ligne n'est une adresse ET qu'au
  // moins une correspond à un libellé connu. Un fichier sans en-tête commence
  // directement par une adresse — on ne veut surtout pas manger sa 1re ligne.
  const firstLineHasEmail = splitCsvLine(lines[0], delimiter).some(
    (c) => isValidEmail(c) || extractAngleBracket(c) !== null,
  );
  const headerMatch = firstCells.some((c) =>
    EMAIL_HEADERS.includes(c) || FIRST_HEADERS.includes(c) || LAST_HEADERS.includes(c) || FULL_HEADERS.includes(c),
  );
  const hasHeader = !firstLineHasEmail && headerMatch;

  let emailIdx = -1, firstIdx = -1, lastIdx = -1, fullIdx = -1;
  if (hasHeader) {
    firstCells.forEach((c, i) => {
      if (emailIdx < 0 && EMAIL_HEADERS.includes(c)) emailIdx = i;
      if (firstIdx < 0 && FIRST_HEADERS.includes(c)) firstIdx = i;
      if (lastIdx < 0 && LAST_HEADERS.includes(c)) lastIdx = i;
      if (fullIdx < 0 && FULL_HEADERS.includes(c)) fullIdx = i;
    });
    // « Nom » sans « Prénom » à côté : c'est un nom complet, pas un patronyme.
    if (lastIdx >= 0 && firstIdx < 0) { fullIdx = lastIdx; lastIdx = -1; }
    const original = splitCsvLine(lines[0], delimiter);
    result.detected = {
      email: emailIdx >= 0 ? original[emailIdx] : undefined,
      firstName: firstIdx >= 0 ? original[firstIdx] : undefined,
      lastName: lastIdx >= 0 ? original[lastIdx] : undefined,
      fullName: fullIdx >= 0 ? original[fullIdx] : undefined,
    };
  }

  const seen = new Set<string>();
  const rows = hasHeader ? lines.slice(1) : lines;

  for (const line of rows) {
    result.totalRows++;
    const cells = splitCsvLine(line, delimiter);

    // 1. Où est l'adresse ? La colonne déclarée, sinon la première cellule qui
    //    ressemble à une adresse — un export mal aligné reste exploitable.
    let email = '';
    let inlineName: string | undefined;

    const tryCell = (cell: string): boolean => {
      if (!cell) return false;
      const angle = extractAngleBracket(cell);
      if (angle && isValidEmail(angle.email)) { email = angle.email; inlineName = angle.name; return true; }
      if (isValidEmail(cell)) { email = cell; return true; }
      return false;
    };

    if (emailIdx >= 0) tryCell(cells[emailIdx] ?? '');
    if (!email) for (const cell of cells) if (tryCell(cell)) break;

    if (!email) {
      // Dernier recours : une ligne sans structure exploitable.
      const loose = line.split(/[\s,;]+/).find((tok) => isValidEmail(tok));
      if (loose) email = loose;
    }

    // Plusieurs adresses sur une même ligne — copier-coller d'un champ « À : ».
    // On ne les prend QUE sur un fichier sans en-tête : dans un CSV structuré,
    // une 2e colonne d'adresse est souvent l'email d'un tiers (parrain, contact
    // de secours) qu'on n'a pas le droit de démarcher.
    if (!hasHeader && email) {
      const extras = line.split(/[\s,;]+/)
        .map((tok) => tok.replace(/^[<"']+|[>"']+$/g, '').trim().toLowerCase())
        .filter((tok) => isValidEmail(tok) && tok !== email.toLowerCase());
      for (const extra of extras) {
        if (seen.has(extra)) { result.duplicates++; continue; }
        seen.add(extra);
        result.contacts.push({ email: extra });
      }
    }

    if (!email) {
      if (result.invalid.length < 50) result.invalid.push(line.slice(0, 120));
      else result.invalid.push('');
      continue;
    }

    const normalized = email.trim().toLowerCase();
    if (seen.has(normalized)) { result.duplicates++; continue; }
    seen.add(normalized);

    // 2. Les noms, si on en trouve.
    let first: string | undefined;
    let last: string | undefined;
    if (firstIdx >= 0) first = cells[firstIdx] || undefined;
    if (lastIdx >= 0) last = cells[lastIdx] || undefined;
    if (!first && !last && fullIdx >= 0 && cells[fullIdx]) {
      const s = splitFullName(cells[fullIdx]);
      first = s.first; last = s.last;
    }
    if (!first && !last && inlineName) {
      const s = splitFullName(inlineName);
      first = s.first; last = s.last;
    }

    const contact: ParsedContact = { email: normalized };
    if (first) contact.first_name = first.slice(0, 80);
    if (last) contact.last_name = last.slice(0, 80);
    result.contacts.push(contact);
  }

  result.invalid = result.invalid.filter(Boolean);
  return result;
}

/** Découpe pour l'envoi : la RPC plafonne à 2 000 contacts par appel. */
export function chunkContacts<T>(items: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const CONSENT_SOURCES = [
  'in_person', 'website_form', 'ticketing', 'social', 'other_tool', 'other',
] as const;
export type ConsentSource = typeof CONSENT_SOURCES[number];
