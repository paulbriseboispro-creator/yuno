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
    <span className={cn('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] font-medium', className)}
      style={{ background: c.bg, color: c.fg }}>
      {children}
    </span>
  );
}

/** Un état avec sa pastille (« Actif », « En pause », « En échec »). */
export function Status({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="a-t2 inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]">
      <span aria-hidden className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: TONE[tone].dot }} />
      {children}
    </span>
  );
}
