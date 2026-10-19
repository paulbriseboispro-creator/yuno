import type { KeyboardEvent, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Carte d'une offre sur la page d'achat (billet standard, billet VIP, formule
// de table VIP). Une seule grammaire, de haut en bas :
//   1. le NOM, sur une ligne, toute la largeur (pastilles à côté s'il reste de
//      la place, dessous sinon) ;
//   2. ce que l'offre donne : la description du pro, puis les conditions ;
//   3. le PRIX à gauche, l'action à droite (quantité, Réserver, ou statut).
// Le nom ne partage jamais sa ligne avec le sélecteur de quantité : c'est ce
// qui le coupait en deux sur téléphone.
// ─────────────────────────────────────────────────────────────────────────────

export type OfferTone = 'default' | 'soldOut' | 'disabled';

interface OfferCardProps {
  title: string;
  /** Pastilles à côté du nom (Épuisé, VIP, Bientôt, rareté…). */
  badges?: ReactNode;
  /** Sous le nom : description, conditions, compteurs. */
  children?: ReactNode;
  /** En bas à gauche. */
  price: ReactNode;
  /** En bas à droite : quantité, bouton ou statut. */
  action: ReactNode;
  /** Sous la carte, dans son cadre (ex. l'action qui débloque un tarif communauté). */
  footer?: ReactNode;
  selected?: boolean;
  /** `soldOut` reste lisible (la pastille rouge doit se voir), `disabled` s'efface. */
  tone?: OfferTone;
  /** Absent = la carte ne se choisit pas d'un tap. */
  onSelect?: () => void;
  ariaLabel: string;
  /** id de la description, lue par les lecteurs d'écran avec le nom. */
  describedBy?: string;
}

export function OfferCard({
  title, badges, children, price, action, footer, selected = false, tone = 'default', onSelect, ariaLabel, describedBy,
}: OfferCardProps) {
  const clickable = !!onSelect && tone === 'default' && !selected;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!clickable || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.();
    }
  };

  return (
    <div
      className={cn(
        'relative rounded-md border overflow-hidden transition-[border-color,background-color,transform] duration-150',
        selected
          ? 'border-primary/75'
          : tone === 'soldOut'
            ? 'border-primary/[0.14] bg-[var(--sf-141414)]'
            : tone === 'disabled'
              ? 'opacity-45 border-white/[0.06] bg-[var(--sf-141414)]'
              : 'border-white/[0.08] bg-[var(--sf-141414)]',
        clickable && 'cursor-pointer hover:border-white/[0.16] active:scale-[0.99]',
      )}
      style={selected ? { backgroundColor: 'rgba(232,25,44,0.09)' } : undefined}
      onClick={() => { if (clickable) onSelect?.(); }}
      role={onSelect && tone === 'default' ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-pressed={onSelect && tone === 'default' ? selected : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="p-4">
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
          <h3
            title={title}
            className={cn(
              'min-w-0 max-w-full truncate text-[15px] font-bold uppercase tracking-wide leading-tight',
              tone === 'soldOut' && !selected && 'text-white/45',
            )}
          >
            {title}
          </h3>
          {badges}
        </div>

        {children && <div className="mt-2 space-y-2">{children}</div>}

        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">{price}</div>
          <div className="shrink-0 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>{action}</div>
        </div>
      </div>
      {footer}
    </div>
  );
}

/** Texte de ce que l'offre donne : la description du pro, ou une condition. */
export function OfferText({ id, muted, className, children }: { id?: string; muted?: boolean; className?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className={cn(
        'text-[13px] leading-[1.55] whitespace-pre-line [overflow-wrap:anywhere]',
        muted ? 'text-white/40' : 'text-white/60',
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Prix en bas à gauche de la carte. */
export function OfferPrice({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <p className={cn('text-[17px] font-bold tabular-nums leading-none', muted && 'text-white/40')}>{children}</p>;
}

/** Statut à la place de la quantité (Bientôt, Épuisé, Complet…). */
export function OfferStatus({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'red' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-sm border',
        tone === 'red' ? 'text-primary border-primary/30' : 'text-white/55 border-white/10',
      )}
    >
      {children}
    </span>
  );
}

export function QuantitySelector({
  quantity, onQuantityChange, min = 0, max = 10,
}: {
  quantity: number; onQuantityChange: (delta: number) => void; min?: number; max?: number;
}) {
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={cn(
          'h-8 w-8 rounded-sm flex items-center justify-center transition-all duration-150',
          quantity > min
            ? 'bg-white/[0.09] text-white/70 hover:bg-white/[0.14] active:scale-90'
            : 'bg-white/[0.04] text-white/15 cursor-default'
        )}
        onClick={() => quantity > min && onQuantityChange(-1)}
        disabled={quantity <= min}
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence mode="wait">
        <motion.span
          key={quantity}
          initial={{ scale: 1.25, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.75, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22, duration: 0.12 }}
          className={cn('text-base font-bold w-5 text-center tabular-nums select-none', quantity === 0 ? 'text-white/55' : 'text-white')}
          aria-live="polite"
        >
          {quantity}
        </motion.span>
      </AnimatePresence>

      <button
        type="button"
        className={cn(
          'h-8 w-8 rounded-sm flex items-center justify-center transition-all duration-150',
          quantity < max
            ? 'text-snow active:scale-90'
            : 'text-white/15 cursor-default'
        )}
        style={quantity < max ? { backgroundColor: 'rgba(232,25,44,0.85)' } : { backgroundColor: 'rgb(var(--ink)/0.04)' }}
        onClick={() => quantity < max && onQuantityChange(1)}
        disabled={quantity >= max}
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
