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

/** Écrit un CSV (séparateur `;`, BOM UTF-8 pour Excel) et le télécharge. */
export function downloadCsv(filename: string, columns: string[], rows: unknown[][]) {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  downloadText(filename, [columns, ...rows].map((r) => r.map(esc).join(';')).join('\r\n'));
}
