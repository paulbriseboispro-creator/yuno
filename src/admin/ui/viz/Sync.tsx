/** Survol synchronisé entre plusieurs graphiques posés sur le même axe du temps. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Sync { index: number | null; setIndex: (i: number | null) => void }
const SyncContext = createContext<Sync | null>(null);

/** Les graphiques posés dedans partagent l'index survolé (même axe du temps). */
export function HoverSync({ children }: { children: ReactNode }) {
  const [index, setIndexState] = useState<number | null>(null);
  const setIndex = useCallback((i: number | null) => setIndexState(i), []);
  const v = useMemo(() => ({ index, setIndex }), [index, setIndex]);
  return <SyncContext.Provider value={v}>{children}</SyncContext.Provider>;
}

/** L'index survolé : partagé dans un HoverSync, local sinon. */
export function useHoverIndex(): Sync {
  const shared = useContext(SyncContext);
  const [local, setLocal] = useState<number | null>(null);
  return shared ?? { index: local, setIndex: setLocal };
}

