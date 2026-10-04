/** Vrai quand la fenêtre est plus étroite que `px` (suivi au redimensionnement). */
import { useEffect, useState } from 'react';

export function useNarrow(px = 900): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [px]);
  return narrow;
}
