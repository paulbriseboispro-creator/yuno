import { useEffect, useRef, useState, type RefObject } from 'react';
import { haptics } from '@/lib/haptics';

/* ============================================================
   usePullToRefresh — tirer vers le bas pour rafraîchir (app native).

   Le geste que tout le monde connaît (Mail, Revolut, Instagram) : depuis le
   haut de la liste, on tire, un indicateur descend avec le doigt (avec
   friction : plus on tire, moins il bouge), on relâche au-delà du seuil et
   la liste se recharge. Tactile uniquement — un pointeur souris n'a pas ce
   geste. Aucune dépendance : `touchstart/move/end` sur le conteneur qui
   défile, et une seule valeur d'état (`pull`) que l'indicateur consomme.

     const { pull, refreshing } = usePullToRefresh(mainRef, () => refetch());

   `pull` = déplacement en px après friction (0 au repos), `refreshing` = la
   promesse `onRefresh` est en cours (l'indicateur reste posé à THRESHOLD).
   ============================================================ */

const THRESHOLD = 64;   // px (après friction) : relâcher au-delà = rafraîchir
const MAX_PULL = 110;   // butée visuelle
const FRICTION = 0.5;   // 1 px de doigt = 0,5 px d'indicateur

export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement>,
  onRefresh: () => Promise<unknown> | unknown,
  enabled = true,
) {
  const [pull, setPullState] = useState(0);
  const [refreshing, setRefreshingState] = useState(false);
  // Miroirs en ref : les listeners sont posés UNE fois, jamais re-souscrits
  // à chaque pixel de geste.
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const setPull = (v: number) => { pullRef.current = v; setPullState(v); };
  const setRefreshing = (v: boolean) => { refreshingRef.current = v; setRefreshingState(v); };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    // Pas de geste sur un appareil sans écran tactile.
    if (typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)').matches) return;

    const atTop = () => el.scrollTop <= 0 && window.scrollY <= 0;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) return;
      startY.current = e.touches[0].clientY;
      pulling.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || !atTop()) {
        if (pulling.current) { pulling.current = false; setPull(0); }
        return;
      }
      pulling.current = true;
      const eased = Math.min(MAX_PULL, dy * FRICTION);
      setPull(eased);
      // Le geste appartient au rafraîchissement : on bloque le « rubber band »
      // natif d'iOS qui tirerait toute la page.
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = async () => {
      const wasPulling = pulling.current;
      const reached = pullRef.current >= THRESHOLD;
      startY.current = null;
      pulling.current = false;
      if (!wasPulling) return;
      if (!reached) { setPull(0); return; }
      // Le seuil franchi se sent sous le doigt (natif uniquement, no-op sur le web).
      haptics.selection();
      setRefreshing(true);
      setPull(THRESHOLD);
      try { await onRefreshRef.current(); } catch { /* le rafraîchissement est best-effort */ }
      setRefreshing(false);
      setPull(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef, enabled]);

  return { pull, refreshing, threshold: THRESHOLD };
}
