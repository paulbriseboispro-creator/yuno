/**
 * Export CSV d'un écran d'analyse : BOM UTF-8 + `;` (Excel français ouvre
 * sans assistant), nombres bruts (le tableur formate), livré par
 * `deliverDocument` (téléchargement sur le web, feuille de partage en natif).
 */
import { deliverDocument } from '@/lib/generateDocuments';

export type CsvCell = string | number | null | undefined | boolean;

export function csvEscape(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\r\n');
}

export function csvBlob(header: string[], rows: CsvCell[][]): Blob {
  return new Blob(['﻿' + buildCsv(header, rows)], { type: 'text/csv;charset=utf-8;' });
}

export async function deliverCsv(filename: string, header: string[], rows: CsvCell[][], title?: string) {
  return deliverDocument(csvBlob(header, rows), filename.endsWith('.csv') ? filename : `${filename}.csv`, title);
}
