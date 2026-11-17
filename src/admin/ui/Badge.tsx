/**
 * Status / Badge : une étiquette courte. Le ton porte le sens (positif,
 * négatif, attention, neutre, accent), jamais une couleur choisie à la main.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

import { TONE, type Tone } from './tone';

export type { Tone };

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const c = TONE[tone];
  return (
    <span className={cn('inline-flex min-h-[22px] max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium leading-snug', className)}
      style={{ background: c.bg, color: c.fg }}>
      {children}
    </span>
  );
}

/** Un état avec sa pastille (« Actif », « En pause », « En échec »). */
export function Status({ tone = 'neutral', children, strong }: { tone?: Tone; children: ReactNode; /** L'état est la donnée de la ligne : encre forte. */ strong?: boolean }) {
  return (
    <span className={`${strong ? 'a-t1 font-medium' : 'a-t2'} inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]`}>
      <span aria-hidden className={`${strong ? 'h-[8px] w-[8px]' : 'h-[7px] w-[7px]'} flex-none rounded-full`} style={{ background: TONE[tone].dot }} />
      {children}
    </span>
  );
}
