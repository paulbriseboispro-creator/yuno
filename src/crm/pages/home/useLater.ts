/** « Plus tard » de l'accueil : les actions reportées jusqu'au lendemain, sur cet appareil. */
import { useEffect, useState } from 'react';

function laterKey(scopeKey: string) {
  const d = new Date();
  return `yuno.crm.later.${scopeKey}.${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function useLater(scopeKey: string): [string[], (id: string) => void, () => void] {
  const key = laterKey(scopeKey);
  const [later, setLater] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]') as string[]; } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(later)); } catch { /* préférence perdue : sans gravité */ }
  }, [key, later]);
  return [later, (id) => setLater((l) => (l.includes(id) ? l : [...l, id])), () => setLater([])];
}
