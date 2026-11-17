/**
 * Le clavier des listes de l'admin (v3, une seule règle partout) :
 * j / k / flèches choisissent une ligne, entrée l'ouvre, la ligne choisie
 * reste visible (`data-row-id`). Rien quand on écrit dans un champ ou qu'une
 * fenêtre est ouverte, rien avec ⌘ / Ctrl / Alt.
 */
import { useEffect } from 'react';

/** Vrai quand la touche est tapée dans un champ ou une fenêtre (on n'intercepte rien). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || !!el.closest?.('[role="dialog"]');
}

/** Index de la ligne suivante / précédente, borné ; sans sélection, la première. */
export function stepIndex(i: number, n: number, dir: 1 | -1): number {
  if (n <= 0) return -1;
  if (i < 0) return 0;
  return Math.max(0, Math.min(n - 1, i + dir));
}

export function useListKeys<T>(rows: T[], idOf: (r: T) => string, selected: string | null, setSelected: (id: string) => void, open: (r: T) => void,
  /** Touches propres à la page (e, l…), appelées avec la ligne choisie. */
  extra?: Record<string, (r: T, i: number) => void>) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || rows.length === 0) return;
      const i = rows.findIndex((r) => idOf(r) === selected);
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelected(idOf(rows[stepIndex(i, rows.length, 1)])); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(idOf(rows[stepIndex(i, rows.length, -1)])); }
      else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); open(rows[i]); }
      else if (extra?.[e.key] && i >= 0) { e.preventDefault(); extra[e.key](rows[i], i); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [rows, idOf, selected, setSelected, open, extra]);
  useEffect(() => {
    if (!selected) return;
    const el = document.querySelector(`[data-row-id="${CSS.escape(selected)}"]`);
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [selected]);
}
