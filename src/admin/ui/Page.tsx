/**
 * Une page de l'admin = une question, écrite en titre (« Qui achète sur
 * Yuno ? »), une phrase de sous-titre, ses actions, et le choix de période
 * quand ses chiffres en dépendent. Section et Card rangent le reste.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PeriodPicker } from './PeriodPicker';

export function Page({
  title, subtitle, actions, period = false, children, width = 'wide',
}: {
  /** La question, en toutes lettres. */
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Affiche le choix de période (7 j, 30 j, 90 j, 12 mois) de `useAdminFilters`. */
  period?: boolean;
  children?: ReactNode;
  width?: 'wide' | 'narrow';
}) {
  return (
    <div className={cn('mx-auto w-full px-5 py-6 md:px-8 md:py-8', width === 'wide' ? 'max-w-[1280px]' : 'max-w-[880px]')}>
      <header className="mb-6 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="a-t1 text-[22px] font-semibold leading-[1.25] tracking-[-0.02em]" style={{ textWrap: 'balance' }}>{title}</h1>
          {subtitle && <p className="a-t2 mt-1 max-w-[80ch] text-[14px] leading-normal">{subtitle}</p>}
        </div>
        {(actions || period) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {period && <PeriodPicker />}
          </div>
        )}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

export function Section({
  title, description, actions, children, className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="a-t1 text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>}
            {description && <p className="a-t3 mt-0.5 text-[13px]">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({
  title, actions, children, className, padded = true, footer,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className={cn('a-card flex min-w-0 flex-col', className)}>
      {(title || actions) && (
        <div className="flex min-h-[44px] items-center gap-3 border-b px-4 py-2.5">
          <div className="a-t1 min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</div>
          {actions}
        </div>
      )}
      <div className={cn('min-w-0 flex-1', padded && 'p-4')}>{children}</div>
      {footer && <div className="a-t2 border-t px-4 py-2.5 text-[12.5px]">{footer}</div>}
    </div>
  );
}

/** Grille responsive de cartes (2 à 4 colonnes). */
export function Grid({ cols = 2, children, className }: { cols?: 2 | 3 | 4; children: ReactNode; className?: string }) {
  const c = cols === 4 ? 'lg:grid-cols-4 sm:grid-cols-2' : cols === 3 ? 'lg:grid-cols-3 sm:grid-cols-2' : 'lg:grid-cols-2';
  return <div className={cn('grid grid-cols-1 gap-4', c, className)}>{children}</div>;
}
