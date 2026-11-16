/**
 * Onglets d'une page, adressables : la valeur vit dans l'adresse (`?tab=` par
 * défaut), un lien ouvre donc le bon onglet. Le premier onglet est le défaut
 * et n'écrit rien dans l'adresse.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

import type { TabItem } from './useTab';

export type { TabItem };

export function Tabs({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b', className)}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button key={it.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(it.value)}
            className="a-focus relative -mb-px inline-flex h-9 items-center gap-1.5 whitespace-nowrap border-0 bg-transparent px-3 font-[inherit] text-[13px] font-medium"
            style={{ cursor: 'pointer', color: on ? 'var(--a-text)' : 'var(--a-text-2)', borderBottom: `2px solid ${on ? 'var(--a-accent)' : 'transparent'}` }}>
            {it.label}
            {it.count != null && <span className="a-num a-subtle rounded px-1.5 text-[11.5px]" style={{ color: 'var(--a-text-2)' }}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
