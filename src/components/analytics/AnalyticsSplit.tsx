/**
 * La mise en page commune des vues d'ensemble : le contenu à gauche, la colonne
 * des soirées à droite (défilante, collée sous l'en-tête sur grand écran). Sur
 * téléphone la colonne devient une bande horizontale AU-DESSUS du contenu : on
 * choisit d'abord « quoi regarder », puis on lit.
 */
import type { ReactNode } from 'react';

export function AnalyticsSplit({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_292px] xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="order-2 min-w-0 space-y-4 lg:order-1">{children}</div>
      <aside className="order-1 min-w-0 lg:sticky lg:top-20 lg:order-2">{rail}</aside>
    </div>
  );
}
