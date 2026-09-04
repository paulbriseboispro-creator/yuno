// Listes imprimables — guest list, tables VIP, billetterie.
//
// Une seule fabrique pour les trois piliers, parce que le besoin est le même :
// sortir de l'app une liste qui tient sur du papier à l'entrée d'un club, ou
// dans un tableur pour le lendemain. Trois formats, trois usages distincts :
//
//   • 'door'   → PDF « liste de porte » : gros noms triés A→Z, séparateurs par
//                lettre, une case à cocher. Pensé pour être lu à la lampe de
//                téléphone, debout, dans le bruit. Aucune donnée sensible
//                (ni email, ni téléphone, ni montant) : cette feuille traîne sur
//                un tabouret toute la nuit.
//   • 'detail' → PDF complet : toutes les colonnes, en tableau serré. Pour
//                l'organisateur et le club, pas pour la porte.
//   • 'csv'    → tableur (BOM UTF-8 + séparateur ';' pour qu'Excel FR ouvre
//                proprement sans assistant d'import).
//
// La livraison passe par deliverDocument : sur le web c'est un téléchargement,
// dans l'app native c'est la feuille de partage iOS (qui contient « Imprimer »).
// Un <a download> ne fait rien dans la WebView — voir generateDocuments.ts.

import jsPDF from 'jspdf';
import { deliverDocument, downloadBlob, type DeliverOutcome } from '@/lib/generateDocuments';
import { buildXlsx } from '@/lib/xlsx';
import { isNative } from '@/lib/native';
import { shareContent } from '@/lib/share';

export type RosterFormat = 'door' | 'detail' | 'csv' | 'xlsx';

export interface RosterColumn {
  key: string;
  label: string;
  /** Largeur relative (part du tableau). */
  weight: number;
  align?: 'left' | 'right';
}

export type RosterRow = Record<string, string | number | null | undefined>;

export interface RosterDoc {
  /** « Guest list », « Tables VIP », « Billetterie ». */
  kind: string;
  /** Nom de la soirée. */
  eventTitle: string;
  /** « Vendredi 11 septembre · Club X · 23h00 ». */
  eventSubtitle: string;
  /** Colonnes du mode détail / CSV. */
  columns: RosterColumn[];
  rows: RosterRow[];
  /** Clé de la colonne qui porte le nom, pour le mode porte. */
  nameKey: string;
  /** Colonnes secondaires affichées en petit sous le nom, en mode porte. */
  doorMetaKeys?: string[];
  /** Chiffres de tête : « 143 invités · 0 entrés ». */
  summary?: string[];
  /** Mention de bas de page (RGPD, confidentialité). */
  footnote?: string;
  /** Texte affiché quand il n'y a aucune ligne — localisé par le constructeur. */
  emptyLabel?: string;
}

// ── Mise en page ─────────────────────────────────────────────────────────────
const PAGE_MARGIN = 14;
const INK = { r: 17, g: 17, b: 20 };
const MUTED = { r: 120, g: 120, b: 128 };
const RULE = { r: 220, g: 220, b: 226 };

function normalizeForSort(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Ramène une chaîne dans WinAnsi, l'encodage des polices intégrées de jsPDF.
 *
 * Piège coûteux : dès qu'UN caractère sort de WinAnsi, jsPDF bascule la chaîne
 * ENTIÈRE en UCS-2 alors que la police reste déclarée WinAnsi — la cellule
 * s'imprime en charabia (un NUL entre chaque glyphe), pas juste le caractère
 * fautif. Deux sources garanties ici :
 *   • `Intl.NumberFormat('fr-FR', {currency:'EUR'})` sépare les milliers avec
 *     U+202F (espace fine insécable). Donc tout montant ≥ 1000 € — exactement
 *     les minimums de dépense d'un bottle service — passait en charabia, alors
 *     que les montants à trois chiffres (U+00A0, lui présent dans WinAnsi)
 *     s'affichaient bien. Invisible en test, systématique en vrai.
 *   • Le « ✓ » de repli des colonnes d'entrée.
 * Les accents latins (é, à, ñ, ç) sont dans WinAnsi et passent intacts.
 */
// CP1252 definit 0x80-0x9F (euro, points de suspension, tirets, guillemets
// typographiques...) ; le reste de Latin-1 passe tel quel. Tout ce qui sort de
// cet ensemble doit etre remplace AVANT le rendu.
const CP1252_EXTRAS = new Set([
  '\u20AC', '\u201A', '\u0192', '\u201E', '\u2026', '\u2020', '\u2021', '\u02C6',
  '\u2030', '\u0160', '\u2039', '\u0152', '\u017D', '\u2018', '\u2019', '\u201C',
  '\u201D', '\u2022', '\u2013', '\u2014', '\u02DC', '\u2122', '\u0161', '\u203A',
  '\u0153', '\u017E', '\u0178',
]);

function toWinAnsi(v: string): string {
  const mapped = v
    // Espaces fines/insecables des formats de nombre (U+202F, U+2009, U+2007).
    // U+00A0 appartient a WinAnsi et peut rester.
    .replace(/[\u202F\u2009\u2007]/g, ' ')
    .replace(/[\u2713\u2714]/g, 'OK')
    .replace(/[\u2011\u2012\u2212]/g, '-')
    .replace(/\u00B7/g, '-');

  // Filet : n'importe quel autre caractere hors jeu (emoji dans un nom de
  // soiree, ideogramme...) est retire plutot que de faire basculer TOUTE la
  // chaine en UCS-2.
  let out = '';
  for (const ch of mapped) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x7E || (code >= 0xA0 && code <= 0xFF) || CP1252_EXTRAS.has(ch)) {
      out += ch;
    }
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function cell(row: RosterRow, key: string): string {
  const v = row[key];
  if (v === null || v === undefined || v === '') return '-';
  return toWinAnsi(String(v));
}

/**
 * Coupe le texte à la largeur disponible, sur UNE ligne.
 *
 * On n'utilise volontairement pas l'option `maxWidth` de jsPDF : elle ne coupe
 * pas, elle REPLIE sur plusieurs lignes (et au milieu d'un mot pour un email
 * long). Or les deux mises en page ci-dessous calculent une hauteur de ligne
 * fixe : la deuxième ligne d'un nom à rallonge venait écraser la ligne
 * suivante, ou se faire recouvrir par le fond zébré de la ligne d'après.
 */
function fitText(doc: jsPDF, text: string, width: number): string {
  if (!text) return '';
  if (doc.getTextWidth(text) <= width) return text;
  const ell = '…'; // présent dans WinAnsi (0x85)
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(text.slice(0, mid) + ell) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + ell : ell;
}

function drawHeader(doc: jsPDF, d: RosterDoc, pageNo: number, printedAt: string): number {
  const w = doc.internal.pageSize.getWidth();
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  // L'horodatage est aligne a droite sur la MEME ligne : le titre doit s'arreter
  // avant, sinon un nom de soiree long lui passe dessus.
  const stamp = toWinAnsi(`${printedAt}   -   p. ${pageNo}`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const stampW = doc.getTextWidth(stamp);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(
    fitText(doc, toWinAnsi(`${d.kind} - ${d.eventTitle}`), w - PAGE_MARGIN * 2 - stampW - 6),
    PAGE_MARGIN, 18,
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(fitText(doc, toWinAnsi(d.eventSubtitle), w - PAGE_MARGIN * 2), PAGE_MARGIN, 24);

  if (d.summary?.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(fitText(doc, toWinAnsi(d.summary.join('   -   ')), w - PAGE_MARGIN * 2), PAGE_MARGIN, 31);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(stamp, w - PAGE_MARGIN, 18, { align: 'right' });

  doc.setDrawColor(RULE.r, RULE.g, RULE.b);
  doc.setLineWidth(0.4);
  const y = d.summary?.length ? 35 : 28;
  doc.line(PAGE_MARGIN, y, w - PAGE_MARGIN, y);
  return y + 7;
}

function drawFootnote(doc: jsPDF, text: string): void {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(toWinAnsi(text), PAGE_MARGIN, h - 8, { maxWidth: w - PAGE_MARGIN * 2 });
}

/**
 * PDF « liste de porte » : un nom par ligne, gros, trié A→Z, avec une case à
 * cocher. Deux colonnes par page — un A4 tient ~70 noms sans devenir illisible.
 */
function buildDoorPdf(d: RosterDoc, printedAt: string): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const bottom = h - 16;

  const rows = [...d.rows].sort((a, b) =>
    normalizeForSort(cell(a, d.nameKey)).localeCompare(normalizeForSort(cell(b, d.nameKey)), 'fr'),
  );

  const colGap = 8;
  const colWidth = (w - PAGE_MARGIN * 2 - colGap) / 2;
  const lineH = 8.2;

  let page = 1;
  let y = drawHeader(doc, d, page, printedAt);
  let col = 0;
  let currentLetter = '';

  const colX = () => PAGE_MARGIN + col * (colWidth + colGap);

  // Haut de la 2e colonne : même ordonnée que ce que drawHeader rend pour la 1re.
  const columnTopY = () => (d.summary?.length ? 42 : 35);

  const nextColumnOrPage = () => {
    if (col === 0) {
      col = 1;
      y = columnTopY();
    } else {
      doc.addPage();
      page += 1;
      col = 0;
      y = drawHeader(doc, d, page, printedAt);
    }
    // Rappeler la lettre en tête de chaque colonne : sans ça, une colonne qui
    // démarre au milieu des « M » n'annonce rien et le videur doit remonter
    // la colonne précédente pour savoir où il est.
    currentLetter = '';
  };

  for (const row of rows) {
    const name = cell(row, d.nameKey);
    const letter = normalizeForSort(name).charAt(0).toUpperCase() || '#';

    if (y + lineH * 2 > bottom) nextColumnOrPage();

    if (letter !== currentLetter) {
      if (y + lineH * 2.5 > bottom) nextColumnOrPage();
      currentLetter = letter;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      doc.text(letter, colX(), y + 3);
      doc.setDrawColor(RULE.r, RULE.g, RULE.b);
      doc.setLineWidth(0.3);
      doc.line(colX() + 5, y + 2, colX() + colWidth, y + 2);
      y += 6;
    }

    // Case à cocher : le videur coche à la main quand il n'a pas de scan.
    doc.setDrawColor(150, 150, 158);
    doc.setLineWidth(0.35);
    doc.rect(colX(), y - 3.2, 4, 4);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(fitText(doc, name, colWidth - 8), colX() + 6.5, y);

    const meta = (d.doorMetaKeys ?? [])
      .map((k) => cell(row, k))
      .filter((v) => v && v !== '—')
      .join(' - ');
    if (meta) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      doc.text(fitText(doc, meta, colWidth - 8), colX() + 6.5, y + 3.4);
      y += lineH + 1.4;
    } else {
      y += lineH;
    }
  }

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(toWinAnsi(d.emptyLabel ?? 'Aucune entree.'), PAGE_MARGIN, y + 4);
  }

  if (d.footnote) drawFootnote(doc, d.footnote);
  return doc.output('blob');
}

/** PDF détaillé : tableau complet, une ligne par entrée. */
function buildDetailPdf(d: RosterDoc, printedAt: string): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const bottom = h - 14;
  const tableW = w - PAGE_MARGIN * 2;

  const totalWeight = d.columns.reduce((s, c) => s + c.weight, 0) || 1;
  const widths = d.columns.map((c) => (c.weight / totalWeight) * tableW);
  const xs: number[] = [];
  let acc = PAGE_MARGIN;
  for (const cw of widths) { xs.push(acc); acc += cw; }

  const rowH = 6.4;
  let page = 1;
  let y = drawHeader(doc, d, page, printedAt);

  const drawColumnHeads = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    d.columns.forEach((c, i) => {
      const x = c.align === 'right' ? xs[i] + widths[i] - 2 : xs[i];
      doc.text(c.label.toUpperCase(), x, y, { align: c.align === 'right' ? 'right' : 'left' });
    });
    doc.setDrawColor(RULE.r, RULE.g, RULE.b);
    doc.setLineWidth(0.3);
    doc.line(PAGE_MARGIN, y + 1.8, w - PAGE_MARGIN, y + 1.8);
    y += 6;
  };

  drawColumnHeads();

  d.rows.forEach((row, idx) => {
    if (y + rowH > bottom) {
      doc.addPage();
      page += 1;
      y = drawHeader(doc, d, page, printedAt);
      drawColumnHeads();
    }
    if (idx % 2 === 1) {
      doc.setFillColor(248, 248, 250);
      doc.rect(PAGE_MARGIN, y - 3.6, tableW, rowH, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.4);
    doc.setTextColor(INK.r, INK.g, INK.b);
    d.columns.forEach((c, i) => {
      const value = cell(row, c.key);
      const x = c.align === 'right' ? xs[i] + widths[i] - 2 : xs[i];
      doc.text(fitText(doc, value, widths[i] - 3), x, y, {
        align: c.align === 'right' ? 'right' : 'left',
      });
    });
    y += rowH;
  });

  if (d.rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(toWinAnsi(d.emptyLabel ?? 'Aucune entree.'), PAGE_MARGIN, y + 4);
  }

  if (d.footnote) drawFootnote(doc, d.footnote);
  return doc.output('blob');
}

/**
 * CSV Excel-compatible : BOM UTF-8 (sinon les accents cassent) et séparateur
 * point-virgule (Excel en locale FR/ES attend ';' — avec ',' tout atterrit dans
 * une seule colonne).
 */
function buildCsv(d: RosterDoc): Blob {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    d.columns.map((c) => esc(c.label)).join(';'),
    ...d.rows.map((row) => d.columns.map((c) => esc(row[c.key] ?? '')).join(';')),
  ];
  return new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
}

function slugify(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'liste';
}

/**
 * Fabrique le document et le livre. Renvoie le résultat de livraison pour que
 * l'appelant dise la vérité dans son toast (en natif, « téléchargé » serait faux).
 */
export async function deliverRoster(
  d: RosterDoc,
  format: RosterFormat,
  printedAtLabel: string,
): Promise<DeliverOutcome> {
  const base = `${slugify(d.kind)}-${slugify(d.eventTitle)}`;
  if (format === 'csv' || format === 'xlsx') {
    // Tableur : .xlsx natif (en-tête figé, filtres, largeurs) ou CSV historique.
    const isXlsx = format === 'xlsx';
    const blob = isXlsx
      ? await buildXlsx(
          d.kind,
          d.columns.map((c) => ({ label: c.label, width: Math.round((c.weight ?? 10) * 1.6), align: c.align })),
          d.rows.map((row) => d.columns.map((c) => row[c.key] ?? '')),
        )
      : buildCsv(d);
    const mime = isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    const filename = `${base}.${isXlsx ? 'xlsx' : 'csv'}`;
    // deliverDocument force le type PDF côté natif : on refait le branchement ici
    // pour que le fichier parte avec la bonne extension dans la feuille de partage.
    if (!isNative()) {
      downloadBlob(blob, filename);
      return 'downloaded';
    }
    const file = new File([blob], filename, { type: mime });
    const outcome = await shareContent({ title: d.eventTitle, files: [file] });
    return outcome === 'shared' ? 'shared' : outcome === 'dismissed' ? 'dismissed' : 'failed';
  }

  const blob = format === 'door'
    ? buildDoorPdf(d, printedAtLabel)
    : buildDetailPdf(d, printedAtLabel);
  return deliverDocument(blob, `${base}-${format === 'door' ? 'porte' : 'detail'}.pdf`, d.eventTitle);
}
