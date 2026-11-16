import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface TabItem { value: string; label: ReactNode; count?: number }

/** Onglet courant lu dans l'adresse (`?tab=` par défaut) ; le premier onglet n'écrit rien. */
export function useTab(items: TabItem[], param = 'tab'): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get(param);
  const value = items.some((i) => i.value === raw) ? (raw as string) : items[0]?.value ?? '';
  const set = (v: string) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (v === items[0]?.value) next.delete(param); else next.set(param, v);
    return next;
  }, { replace: true });
  return [value, set];
}

