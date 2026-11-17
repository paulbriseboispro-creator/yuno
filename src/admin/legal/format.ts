/** Petits outils sans React de la rubrique « Légal ». */

/** `datetime-local` ⇄ ISO, dans le fuseau du navigateur. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string { return v ? new Date(v).toISOString() : ''; }

/**
 * Libellé traduit. Une valeur que le dictionnaire ne connaît pas ne s'affiche
 * plus brute : le traducteur de l'admin rend « Autre : <valeur en mots> ».
 */
export function tOr(t: (k: string) => string, key: string, _raw: string): string {
  return t(key);
}
