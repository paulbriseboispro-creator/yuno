import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Un pack de billets sur la page de choix (billetterie libre, lib/ticketGroups).
// Un cadre, comme une carte d'offre : en tête le NOM du pack en capitales, juste
// dessous « À partir de … », la flèche à droite. Ouvert par défaut ; replié, il
// ne garde que ces deux lignes — sans rouge, même si un billet y est choisi
// (la barre du bas dit déjà ce qui est choisi, décision de Paul du 04/11).
// Ouvert : la phrase du pack, puis ses billets en lignes séparées d'un trait.
// ─────────────────────────────────────────────────────────────────────────────

interface TicketPackSectionProps {
  name: string;
  /** « À partir de 13,00 € », ou le statut quand rien n'est achetable. */
  subtitle: string;
  description?: string | null;
  collapseLabel: string;
  expandLabel: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function TicketPackSection({
  name, subtitle, description, collapseLabel, expandLabel, defaultOpen = true, children,
}: TicketPackSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="rounded-md border border-white/[0.08] bg-[var(--sf-141414)] overflow-hidden" aria-label={name}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center gap-3 pl-4 pr-3.5 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold uppercase tracking-wide leading-tight [overflow-wrap:anywhere]">{name}</span>
          <span className="mt-1 block text-[12.5px] text-white/55 tabular-nums">{subtitle}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            'h-8 w-8 shrink-0 rounded-sm flex items-center justify-center bg-white/[0.06] text-white/75 transition-transform duration-200',
            open && 'rotate-180',
          )}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
        <span className="sr-only">{open ? collapseLabel : expandLabel}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {description && (
              <p className="px-4 pb-3 -mt-1 text-[13px] leading-[1.55] text-white/60 whitespace-pre-line [overflow-wrap:anywhere]">
                {description}
              </p>
            )}
            <div className="divide-y divide-white/[0.07] border-t border-white/[0.07]">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
