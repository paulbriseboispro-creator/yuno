import { cn } from '@/lib/utils';

/** Une jauge : part utilisée d'une capacité. Le ton suit le seuil, jamais une couleur choisie. */
export function Meter({ used, cap, warnAt = 0.7, negAt = 0.9, className }: { used: number; cap: number; warnAt?: number; negAt?: number; className?: string }) {
  const r = cap > 0 ? used / cap : 0;
  const color = r >= negAt ? 'var(--a-neg)' : r >= warnAt ? 'var(--a-warn)' : 'var(--a-pos)';
  return (
    <div className={cn('a-subtle h-1.5 w-full overflow-hidden rounded-full', className)} role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, r * 100))}%`, background: color }} />
    </div>
  );
}
