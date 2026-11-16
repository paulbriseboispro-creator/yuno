/**
 * Une section repliée : le détail qu'on ouvre quand on le cherche. Le kit n'a
 * pas de primitive de ce genre ; c'est un `<details>` natif (clavier et
 * lecteurs d'écran gratuits) habillé avec les variables du kit.
 */
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function Fold({ title, hint, children, defaultOpen = false }: {
  title: ReactNode;
  /** Une ligne grise à droite du titre (« 12 lignes », « 3 en attente »). */
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="a-card group" open={defaultOpen}>
      <summary className="a-focus flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-[12px] px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="a-t3 h-4 w-4 flex-none transition-transform group-open:rotate-90" />
        <span className="a-t1 min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</span>
        {hint && <span className="a-t3 flex-none text-[12px]">{hint}</span>}
      </summary>
      <div className="flex flex-col gap-4 border-t p-4">{children}</div>
    </details>
  );
}
