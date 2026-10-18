/** Télécharge un texte (CSV prêt) avec un BOM UTF-8 pour Excel. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Une cellule de CSV. Un TEXTE qui commence par = + - @ (ou une tabulation,
 * un retour chariot) est lu comme une formule par Excel, LibreOffice ou
 * Google Sheets : un nom saisi chez Shotgun (« =HYPERLINK(…) ») s'exécuterait
 * à l'ouverture de l'export. Il est précédé d'une apostrophe, qui le garde en
 * texte (audit du 18/10, SEC-05). Un nombre reste un nombre.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Écrit un CSV (séparateur `;`, BOM UTF-8 pour Excel) et le télécharge. */
export function downloadCsv(filename: string, columns: string[], rows: unknown[][]) {
  downloadText(filename, [columns, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n'));
}
