/** Petits outils sans React de la rubrique « Légal ». */

/** `datetime-local` ⇄ ISO, dans le fuseau du navigateur. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string { return v ? new Date(v).toISOString() : ''; }

/** Libellé traduit, ou la valeur brute quand la base porte une valeur que le dictionnaire ne connaît pas. */
export function tOr(t: (k: string) => string, key: string, raw: string): string {
  const v = t(key);
  return v === key ? raw : v;
}
