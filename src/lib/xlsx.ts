// Écriture d'un classeur Excel (.xlsx) minimal, sans SheetJS : un .xlsx est
// un zip de fichiers XML (Office Open XML). On n'en produit que ce qu'il faut
// pour une liste : une feuille, un en-tête gras figé, des largeurs de colonnes,
// des cellules texte (inline strings) ou nombre. Ouvert tel quel par Excel,
// Numbers et Google Sheets — accents compris, sans l'étape « importer un CSV ».
//
// fflate est chargé à la demande (dynamic import) : l'export est rare, le
// premier écran d'un client ne doit pas le payer.

export interface XlsxColumn {
  label: string;
  /** Largeur en « caractères » Excel. */
  width?: number;
  align?: 'left' | 'right';
}

export type XlsxCell = string | number | null | undefined;

const esc = (v: string) => v
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // Caractères interdits en XML 1.0 (contrôles), ils feraient refuser le fichier.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colRef(i: number): string {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function cellXml(ref: string, v: XlsxCell, style: number): string {
  if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${style}"/>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

/**
 * Fabrique un .xlsx (Blob) : une feuille `sheetName`, `columns` en en-tête
 * (ligne 1, gras, figée), puis `rows` dans l'ordre des colonnes.
 */
export async function buildXlsx(
  sheetName: string,
  columns: XlsxColumn[],
  rows: XlsxCell[][],
): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');

  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.min(80, c.width ?? 14))}" customWidth="1"/>`).join('');
  const header = `<row r="1">${columns.map((c, i) => cellXml(`${colRef(i)}1`, c.label, 1)).join('')}</row>`;
  const body = rows.map((row, r) => {
    const rr = r + 2;
    return `<row r="${rr}">${columns.map((c, i) => cellXml(`${colRef(i)}${rr}`, row[i], c.align === 'right' ? 3 : 2)).join('')}</row>`;
  }).join('');
  const lastCol = colRef(Math.max(0, columns.length - 1));
  const dim = `A1:${lastCol}${rows.length + 1}`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${header}${body}</sheetData><autoFilter ref="${dim}"/></worksheet>`;

  // Styles : 0 = défaut, 1 = en-tête gras fond gris, 2 = texte, 3 = aligné à droite.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const safeName = esc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Liste');
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }, { level: 6 });

  return new Blob([zipped as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
