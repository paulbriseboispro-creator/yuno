import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Portée des chiffres du super admin : réel seulement (défaut) ou démo incluse.
 *
 * Une seule décision, valable sur toutes les pages, mémorisée sur l'appareil.
 * Chaque RPC de lecture prend `p_include_demo` : la porte démo vit en SQL
 * (is_demo_email / demo_venue_ids / demo_event_ids), jamais côté front.
 */
interface AdminScopeValue {
  includeDemo: boolean;
  setIncludeDemo: (v: boolean) => void;
}

const KEY = 'yuno.admin.includeDemo';
const AdminScopeContext = createContext<AdminScopeValue | undefined>(undefined);

function readStored(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function AdminScopeProvider({ children }: { children: ReactNode }) {
  const [includeDemo, setState] = useState<boolean>(readStored);
  const setIncludeDemo = useCallback((v: boolean) => {
    setState(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* stockage indisponible : la valeur reste en mémoire */ }
  }, []);
  const value = useMemo(() => ({ includeDemo, setIncludeDemo }), [includeDemo, setIncludeDemo]);
  return <AdminScopeContext.Provider value={value}>{children}</AdminScopeContext.Provider>;
}

export function useAdminScope(): AdminScopeValue {
  const ctx = useContext(AdminScopeContext);
  // Hors provider (test, HMR) : réel seulement, sans persistance.
  return ctx ?? { includeDemo: false, setIncludeDemo: () => {} };
}
